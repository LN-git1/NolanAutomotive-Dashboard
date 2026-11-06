-- Web push notifications. New tables only: no existing table is altered, so
-- this can be applied before or after the code that uses it without breaking
-- any current screen. Safe to run twice.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_claims" (
	"key" text PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_limits" (
	"supplier_id" uuid PRIMARY KEY NOT NULL,
	"limit_cents" integer NOT NULL,
	"alert_80_at" timestamp with time zone,
	"alert_100_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_limits" ADD CONSTRAINT "supplier_limits_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- These hold the keys a device registered with, which are not for the public to
-- read. Supabase exposes every table in the public schema through its REST API;
-- with row-level security on and no policy, that API sees nothing. The app
-- connects directly as the database owner, which row-level security does not
-- apply to. The grants are also taken away from the API roles, as a second layer.
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "push_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "supplier_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
  EXECUTE 'REVOKE ALL ON TABLE "push_subscriptions", "push_claims", "supplier_limits" FROM anon';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  EXECUTE 'REVOKE ALL ON TABLE "push_subscriptions", "push_claims", "supplier_limits" FROM authenticated';
 END IF;
END $$;
