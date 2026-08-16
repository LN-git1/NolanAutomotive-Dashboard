ALTER TABLE "invoices" ADD COLUMN "labour_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "labour_total_override" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "labour_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "hourly_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "labour_total_override" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "other_comments" text;--> statement-breakpoint
CREATE INDEX "invoices_voided_at_idx" ON "invoices" USING btree ("voided_at");--> statement-breakpoint
-- `internal_notes` is retired in the next migration. Move anything it holds into
-- `notes` FIRST, in this migration, so the column is empty by the time it is
-- dropped -- a dropped column with data in it is data loss, however small.
UPDATE "jobs"
SET "notes" = CASE
    WHEN COALESCE("notes", '') = '' THEN "internal_notes"
    ELSE "notes" || E'\n\n' || "internal_notes"
  END
WHERE COALESCE("internal_notes", '') <> '';
