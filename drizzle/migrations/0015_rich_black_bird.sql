CREATE TABLE IF NOT EXISTS "digest_runs" (
	"window_end" timestamp with time zone PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
