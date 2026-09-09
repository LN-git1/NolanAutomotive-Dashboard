CREATE TYPE "public"."expense_category" AS ENUM('rent', 'wages', 'utilities', 'fuel', 'parts', 'insurance', 'phone', 'other');--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_date" date NOT NULL,
	"category" "expense_category" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"receipt_storage_path" text,
	"reverses_id" uuid,
	"submission_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_submission_key_key" ON "expenses" USING btree ("submission_key");