CREATE TABLE "assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_assignees" (
	"job_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	CONSTRAINT "job_assignees_job_id_assignee_id_pk" PRIMARY KEY("job_id","assignee_id")
);
--> statement-breakpoint
ALTER TABLE "job_assignees" ADD CONSTRAINT "job_assignees_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignees" ADD CONSTRAINT "job_assignees_assignee_id_assignees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."assignees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignees_archived_at_idx" ON "assignees" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "job_assignees_assignee_id_idx" ON "job_assignees" USING btree ("assignee_id");