ALTER TABLE "jobs" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'active'::text;--> statement-breakpoint
-- Remap while the column is still plain text. drizzle-kit cannot know that 'new'
-- should become 'active', so without this the cast back to the enum below fails
-- with "invalid input value for enum job_status: new" on any surviving row --
-- and it fails midway, after the type has already been dropped.
UPDATE "jobs" SET "status" = 'active' WHERE "status" = 'new';--> statement-breakpoint
DROP TYPE "public"."job_status";--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('active', 'completed', 'invoiced', 'paid');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."job_status";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "status" SET DATA TYPE "public"."job_status" USING "status"::"public"."job_status";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "internal_notes";