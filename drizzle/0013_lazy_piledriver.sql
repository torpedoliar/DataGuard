CREATE TYPE "public"."siem_ai_job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "siem_ai_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"status" "siem_ai_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "siem_ai_jobs" ADD CONSTRAINT "siem_ai_jobs_finding_id_siem_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."siem_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "siem_ai_jobs_finding_idx" ON "siem_ai_jobs" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "siem_ai_jobs_status_created_idx" ON "siem_ai_jobs" USING btree ("status","created_at");