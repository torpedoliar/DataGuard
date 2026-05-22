CREATE TYPE "public"."siem_alert_channel" AS ENUM('telegram', 'email', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."siem_alert_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."siem_finding_status" AS ENUM('Open', 'Acknowledged', 'Resolved');--> statement-breakpoint
CREATE TYPE "public"."siem_rule_type" AS ENUM('single_event', 'threshold', 'sequence', 'absence', 'baseline_anomaly');--> statement-breakpoint
CREATE TYPE "public"."syslog_ingest_status" AS ENUM('received', 'parsed', 'parse_failed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."syslog_transport" AS ENUM('udp', 'tcp', 'tls');--> statement-breakpoint
CREATE TYPE "public"."syslog_trust_level" AS ENUM('unknown', 'trusted', 'untrusted');--> statement-breakpoint
CREATE TYPE "public"."syslog_vendor" AS ENUM('generic', 'mikrotik', 'cisco', 'fortigate', 'linux');--> statement-breakpoint
CREATE TABLE "siem_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"rule_id" integer,
	"channel" "siem_alert_channel" DEFAULT 'telegram' NOT NULL,
	"status" "siem_alert_status" DEFAULT 'pending' NOT NULL,
	"destination" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "siem_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer,
	"source_id" integer,
	"device_id" integer,
	"site_id" integer,
	"title" text NOT NULL,
	"description" text,
	"severity" "incident_severity" DEFAULT 'Medium' NOT NULL,
	"status" "siem_finding_status" DEFAULT 'Open' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"group_key" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_by_id" integer,
	"acknowledged_at" timestamp,
	"resolved_by_id" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "siem_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"severity" "incident_severity" DEFAULT 'Medium' NOT NULL,
	"type" "siem_rule_type" DEFAULT 'single_event' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"alert_enabled" boolean DEFAULT false NOT NULL,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "siem_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_alert_channel" "siem_alert_channel" DEFAULT 'telegram' NOT NULL,
	"telegram_alerts_enabled" boolean DEFAULT false NOT NULL,
	"maintenance_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trusted_networks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parser_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "syslog_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_event_id" integer,
	"source_id" integer,
	"site_id" integer,
	"device_id" integer,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"event_timestamp" timestamp,
	"vendor" "syslog_vendor" DEFAULT 'generic' NOT NULL,
	"facility" text,
	"severity" integer,
	"hostname" text,
	"app_name" text,
	"process_id" text,
	"message" text NOT NULL,
	"normalized_type" text DEFAULT 'unknown' NOT NULL,
	"source_ip" text,
	"source_port" integer,
	"destination_ip" text,
	"destination_port" integer,
	"username" text,
	"interface_name" text,
	"action" text,
	"outcome" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "syslog_events_raw" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"transport" "syslog_transport" DEFAULT 'udp' NOT NULL,
	"source_ip" text NOT NULL,
	"source_port" integer,
	"raw_message" text NOT NULL,
	"ingest_status" "syslog_ingest_status" DEFAULT 'received' NOT NULL,
	"parse_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syslog_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"device_id" integer,
	"name" text NOT NULL,
	"ip_address" text NOT NULL,
	"hostname" text,
	"vendor" "syslog_vendor" DEFAULT 'generic' NOT NULL,
	"transport" "syslog_transport" DEFAULT 'udp' NOT NULL,
	"port" integer DEFAULT 514 NOT NULL,
	"trust_level" "syslog_trust_level" DEFAULT 'unknown' NOT NULL,
	"parser" text DEFAULT 'generic' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "siem_alerts" ADD CONSTRAINT "siem_alerts_finding_id_siem_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."siem_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_alerts" ADD CONSTRAINT "siem_alerts_rule_id_siem_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."siem_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_rule_id_siem_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."siem_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD CONSTRAINT "siem_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_raw_event_id_syslog_events_raw_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."syslog_events_raw"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events_raw" ADD CONSTRAINT "syslog_events_raw_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_sources" ADD CONSTRAINT "syslog_sources_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_sources" ADD CONSTRAINT "syslog_sources_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "siem_alerts_finding_id_idx" ON "siem_alerts" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "siem_alerts_rule_id_idx" ON "siem_alerts" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "siem_alerts_status_idx" ON "siem_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "siem_alerts_next_attempt_at_idx" ON "siem_alerts" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "siem_findings_rule_id_idx" ON "siem_findings" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "siem_findings_source_id_idx" ON "siem_findings" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "siem_findings_device_id_idx" ON "siem_findings" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "siem_findings_site_id_idx" ON "siem_findings" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "siem_findings_status_idx" ON "siem_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "siem_findings_severity_idx" ON "siem_findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "siem_findings_group_key_idx" ON "siem_findings" USING btree ("group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "siem_rules_key_unique" ON "siem_rules" USING btree ("key");--> statement-breakpoint
CREATE INDEX "siem_rules_category_idx" ON "siem_rules" USING btree ("category");--> statement-breakpoint
CREATE INDEX "siem_rules_enabled_idx" ON "siem_rules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "siem_settings_site_id_unique" ON "siem_settings" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_event_id_idx" ON "syslog_events" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "syslog_events_source_id_idx" ON "syslog_events" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "syslog_events_site_id_idx" ON "syslog_events" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "syslog_events_device_id_idx" ON "syslog_events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "syslog_events_received_at_idx" ON "syslog_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_normalized_type_idx" ON "syslog_events" USING btree ("normalized_type");--> statement-breakpoint
CREATE INDEX "syslog_events_source_ip_idx" ON "syslog_events" USING btree ("source_ip");--> statement-breakpoint
CREATE INDEX "syslog_events_username_idx" ON "syslog_events" USING btree ("username");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_source_id_idx" ON "syslog_events_raw" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_received_at_idx" ON "syslog_events_raw" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_source_ip_idx" ON "syslog_events_raw" USING btree ("source_ip");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_ingest_status_idx" ON "syslog_events_raw" USING btree ("ingest_status");--> statement-breakpoint
CREATE INDEX "syslog_sources_ip_address_idx" ON "syslog_sources" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "syslog_sources_site_id_idx" ON "syslog_sources" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "syslog_sources_device_id_idx" ON "syslog_sources" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "syslog_sources_enabled_idx" ON "syslog_sources" USING btree ("enabled");