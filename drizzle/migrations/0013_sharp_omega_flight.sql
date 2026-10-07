ALTER TABLE "jobs" ADD COLUMN "submission_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_submission_key_key" ON "jobs" USING btree ("submission_key");