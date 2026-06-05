ALTER TABLE "syslog_sources" ADD COLUMN "raw_retention_days" integer;--> statement-breakpoint
ALTER TABLE "syslog_sources" ADD COLUMN "event_retention_days" integer;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD COLUMN "evidence_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "siem_evidence_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"original_event_id" integer NOT NULL,
	"event_time" timestamp,
	"received_at" timestamp NOT NULL,
	"source_ip" text NOT NULL,
	"hostname" text,
	"device_id" integer,
	"source_id" integer,
	"message" text NOT NULL,
	"raw_message" text,
	"category" text,
	"normalized_type" text,
	"action" text,
	"outcome" text,
	"src_ip" text,
	"dst_ip" text,
	"username" text,
	"severity" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp DEFAULT now()
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siem_evidence_events" ADD CONSTRAINT "siem_evidence_events_finding_id_siem_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."siem_findings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siem_evidence_events" ADD CONSTRAINT "siem_evidence_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siem_evidence_events" ADD CONSTRAINT "siem_evidence_events_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_evidence_events_finding_idx" ON "siem_evidence_events" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_evidence_events_original_idx" ON "siem_evidence_events" USING btree ("original_event_id");
