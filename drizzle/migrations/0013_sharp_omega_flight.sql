ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "submission_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_submission_key_key" ON "jobs" USING btree ("submission_key");