CREATE TYPE "public"."import_kind" AS ENUM('screenshot', 'markdown', 'voice');--> statement-breakpoint
CREATE TABLE "import_parse_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "import_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_parse_attempts_created_at_idx" ON "import_parse_attempts" USING btree ("created_at");