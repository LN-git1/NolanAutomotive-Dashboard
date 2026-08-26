ALTER TABLE "invoices" ADD COLUMN "parts_total_override" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "parts_total_override" numeric(12, 2);