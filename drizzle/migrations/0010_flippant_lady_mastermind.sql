CREATE TYPE "public"."supplier_entry_kind" AS ENUM('charge', 'payment');--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD COLUMN "kind" "supplier_entry_kind" DEFAULT 'charge' NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_bills_kind_idx" ON "supplier_bills" USING btree ("kind");