CREATE TABLE IF NOT EXISTS "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"message" text NOT NULL,
	"code" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "error_log_occurred_at_idx" ON "error_log" USING btree ("occurred_at");