-- Backfill job content from invoices issued BEFORE the content moved onto the job.
--
-- Migration 0001 added jobs.labour_lines / parts / hourly_rate and defaulted them
-- empty. Any invoice issued before that still holds the real content in its own
-- snapshot columns, while its job holds nothing. That combination is dangerous:
-- regenerating reads the JOB, so re-sending such an invoice would overwrite the
-- customer's only copy with a blank, zero-value document.
--
-- The regenerate route now refuses that outright, but refusing is a floor, not a
-- fix -- the owner should be able to correct and re-send an old invoice like any
-- other. This copies the content back onto the job so that works.
--
-- What is deliberately NOT invented: per-line hours. The old template printed a
-- single AMOUNT, so the split of `labour_hours` across the description lines is
-- genuinely unknown. Each line therefore gets a blank HOUR(S) cell, and the money
-- is preserved exactly via labour_total_override rather than being re-derived
-- from hours x rate and drifting by a cent.

UPDATE "jobs" j
SET
  "labour_lines" = COALESCE(src."lines", '[]'::jsonb),
  "parts" = COALESCE(src."parts", '[]'::jsonb),
  "hourly_rate" = src."hourly_rate",
  "labour_total_override" = src."total_services",
  "other_comments" = COALESCE(j."other_comments", src."other_comments")
FROM (
  SELECT
    i."job_id",
    i."hourly_rate",
    i."total_services",
    i."other_comments",
    (
      SELECT jsonb_agg(jsonb_build_object('description', btrim(line), 'hours', ''))
      FROM regexp_split_to_table(COALESCE(i."work_carried_out", ''), E'\n') AS line
      WHERE btrim(line) <> ''
    ) AS "lines",
    (
      SELECT jsonb_agg(jsonb_build_object(
        'partName',   COALESCE(p->>'partName', ''),
        'partNumber', COALESCE(p->>'partNumber', ''),
        'qty',        COALESCE(p->>'qty', '0'),
        'unitPrice',  COALESCE(p->>'unitPrice', '0')
      ))
      FROM jsonb_array_elements(COALESCE(i."parts", '[]'::jsonb)) AS p
    ) AS "parts"
  FROM "invoices" i
  WHERE i."voided_at" IS NULL
    -- Only pre-rework invoices: these carry free-text work and no labour lines.
    AND i."labour_lines" = '[]'::jsonb
    AND COALESCE(i."work_carried_out", '') <> ''
) AS src
WHERE j."id" = src."job_id"
  -- Never overwrite a job that already has content entered on it.
  AND j."labour_lines" = '[]'::jsonb
  AND j."parts" = '[]'::jsonb;
