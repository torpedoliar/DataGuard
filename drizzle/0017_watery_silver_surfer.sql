CREATE TABLE "siem_events_quarantine" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_event_id" integer NOT NULL,
	"event_time" timestamp,
	"received_at" timestamp NOT NULL,
	"source_ip" text NOT NULL,
	"hostname" text,
	"message" text NOT NULL,
	"severity" integer,
	"raw_event_id" integer,
	"quarantined_at" timestamp DEFAULT now(),
	"quarantined_reason" text
);
--> statement-breakpoint
ALTER TABLE "siem_settings" ADD COLUMN "quarantine_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD COLUMN "quarantine_retention_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
CREATE INDEX "siem_events_quarantine_received_at_idx" ON "siem_events_quarantine" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "siem_events_quarantine_quarantined_at_idx" ON "siem_events_quarantine" USING btree ("quarantined_at");