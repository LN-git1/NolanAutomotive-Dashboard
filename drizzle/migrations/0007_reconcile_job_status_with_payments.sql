-- Reconcile jobs.status with what the payments actually say.
--
-- `updateJob` used to parse the job form with the full `jobInputSchema` and
-- spread the result into the UPDATE, so the form's status <select> was written
-- on every save. That select was uncontrolled (`defaultValue`), so it held the
-- value the page was rendered with rather than the job's current one: recording
-- a payment flipped a job to `paid`, and the next save on that page silently put
-- it back. Nothing in the app could then correct it.
--
-- Live data at the time of writing:
--   J-0019  status `completed`  invoice NA-2026-0017  EUR 450.00 of EUR 450.00 paid
--   J-0020  status `completed`  invoice NA-2026-0015  EUR 700.00 of EUR 1095.00 paid
--
-- Both had been invoiced; one had been settled in full. Every list that read
-- `jobs.status` reported them faithfully and wrongly — J-0019 sat in Awaiting
-- Payments showing EUR 0.00 owed and never appeared in the Paid count.
--
-- The queries no longer trust this column for money (see
-- `lib/db/queries/invoice-state.ts` — "owed" and "paid" are derived from the
-- payments), so this migration changes no behaviour on its own. It corrects the
-- badge, which is the part of the wrong state a reader can still see, and it
-- leaves the column agreeing with reality rather than quietly contradicting it.
--
-- Idempotent: re-running matches nothing once the rows are correct. It only ever
-- moves a job FORWARD to the stage its own invoice has already reached, so it
-- cannot overwrite a status the owner set deliberately for work still in hand.

-- Settled in full -> paid.
UPDATE "jobs" j
SET "status" = 'paid', "updated_at" = now()
WHERE j."deleted_at" IS NULL
  AND j."status" <> 'paid'
  AND EXISTS (
    SELECT 1
    FROM "invoices" i
    WHERE i."job_id" = j."id"
      AND i."voided_at" IS NULL
      AND i."grand_total" * 100 <= COALESCE(
        (SELECT SUM(p."amount") * 100 FROM "payments" p WHERE p."invoice_id" = i."id"), 0
      )
  );
--> statement-breakpoint

-- Has a live invoice with money still owed, but the status never made it past
-- the workshop -> invoiced. Restricted to `active`/`completed` so a status the
-- owner has deliberately moved elsewhere is left alone.
UPDATE "jobs" j
SET "status" = 'invoiced', "updated_at" = now()
WHERE j."deleted_at" IS NULL
  AND j."status" IN ('active', 'completed')
  AND EXISTS (
    SELECT 1
    FROM "invoices" i
    WHERE i."job_id" = j."id"
      AND i."voided_at" IS NULL
      AND i."grand_total" * 100 > COALESCE(
        (SELECT SUM(p."amount") * 100 FROM "payments" p WHERE p."invoice_id" = i."id"), 0
      )
  );
