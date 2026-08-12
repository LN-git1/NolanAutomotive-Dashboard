CREATE TYPE "public"."counter_key" AS ENUM('invoice', 'job');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('new', 'active', 'completed', 'invoiced', 'paid');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."sent_via" AS ENUM('email', 'whatsapp', 'share');--> statement-breakpoint
CREATE TABLE "counters" (
	"key" "counter_key" PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"job_id" uuid NOT NULL,
	"issue_date" date NOT NULL,
	"work_carried_out" text,
	"labour_hours" numeric(8, 2),
	"hourly_rate" numeric(10, 2),
	"services_subtotal" numeric(12, 2) NOT NULL,
	"parts_subtotal" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"vat_amount" numeric(12, 2) NOT NULL,
	"total_services" numeric(12, 2) NOT NULL,
	"total_parts" numeric(12, 2) NOT NULL,
	"grand_total" numeric(12, 2) NOT NULL,
	"parts" jsonb NOT NULL,
	"other_comments" text,
	"pdf_storage_path" text NOT NULL,
	"sent_via" "sent_via" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text,
	"file_size_bytes" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_number" text NOT NULL,
	"status" "job_status" DEFAULT 'new' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"customer_address" text,
	"vehicle_registration" text NOT NULL,
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_vin" text,
	"vehicle_mileage" integer,
	"vehicle_year" integer,
	"vehicle_color" text,
	"notes" text,
	"internal_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"business_name" text,
	"business_address" text,
	"business_phone" text,
	"business_email" text,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"vat_number" text,
	"default_vat_rate" numeric(5, 2) DEFAULT '23.00' NOT NULL,
	"default_hourly_rate" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"bill_date" date NOT NULL,
	"reference" text,
	"notes" text,
	"attachment_storage_path" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_attachments" ADD CONSTRAINT "job_attachments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_job_id_idx" ON "invoices" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_attachments_job_id_idx" ON "job_attachments" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_job_number_key" ON "jobs" USING btree ("job_number");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_vehicle_registration_idx" ON "jobs" USING btree ("vehicle_registration");--> statement-breakpoint
CREATE INDEX "jobs_customer_name_idx" ON "jobs" USING btree ("customer_name");--> statement-breakpoint
CREATE INDEX "jobs_deleted_at_idx" ON "jobs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "supplier_bills_supplier_id_idx" ON "supplier_bills" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_bills_paid_at_idx" ON "supplier_bills" USING btree ("paid_at");