-- PIC alert email history (lib/email.ts):
--
-- One row per email actually sent from a checklist submit: each PIC user
-- (owner of a device group bound to a NOT-OK device) gets one email listing
-- all their affected devices, so the row stores device_count +
-- device_summary (text snapshot) instead of a per-device FK. entry_id keeps
-- the relational anchor to the checklist submit.
--
-- status is written once by the inline sender (sent/failed). 'pending'
-- exists for a future retry worker but is never produced today. Deploys
-- without SMTP_URL skip sending entirely (no rows), so the table only ever
-- holds real attempts.
CREATE TYPE "public"."email_alert_status" AS ENUM('pending','sent','failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"entry_id" integer,
	"recipient" text NOT NULL,
	"recipient_name" text,
	"subject" text NOT NULL,
	"device_count" integer NOT NULL DEFAULT 0,
	"device_summary" text,
	"status" "email_alert_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "email_alerts" ADD CONSTRAINT "email_alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_alerts" ADD CONSTRAINT "email_alerts_entry_id_checklist_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "checklist_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_alerts_site_created_idx" ON "email_alerts" ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_alerts_status_created_idx" ON "email_alerts" ("status","created_at");
