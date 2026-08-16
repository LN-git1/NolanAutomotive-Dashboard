ALTER TABLE "invoices" ALTER COLUMN "sent_via" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "sent_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "sent_at" DROP NOT NULL;