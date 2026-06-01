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
	"channel" "siem_alert_channel" NOT NULL,
	"recipient" text,
	"status" "siem_alert_status" DEFAULT 'pending' NOT NULL,
	"message" text NOT NULL,
	"sent_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "siem_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"device_id" integer,
	"source_id" integer,
	"rule_id" integer,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"human_analysis" text,
	"recommended_action" text,
	"ai_analysis" jsonb,
	"ai_generated_at" timestamp,
	"severity" "incident_severity" NOT NULL,
	"status" "siem_finding_status" DEFAULT 'Open' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"sample_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correlation_key" text NOT NULL,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"created_incident_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "siem_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"category" text NOT NULL,
	"rule_type" "siem_rule_type" NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"threshold" integer,
	"window_seconds" integer,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"alert_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "siem_rules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "siem_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"default_siem_site_id" integer,
	"udp_port" integer DEFAULT 514 NOT NULL,
	"tcp_enabled" boolean DEFAULT false NOT NULL,
	"tcp_port" integer DEFAULT 514 NOT NULL,
	"tls_enabled" boolean DEFAULT false NOT NULL,
	"tls_port" integer DEFAULT 6514 NOT NULL,
	"max_message_size" integer DEFAULT 16384 NOT NULL,
	"queue_limit" integer DEFAULT 1000 NOT NULL,
	"batch_size" integer DEFAULT 100 NOT NULL,
	"flush_interval_ms" integer DEFAULT 1000 NOT NULL,
	"raw_retention_days" integer DEFAULT 90 NOT NULL,
	"event_retention_days" integer DEFAULT 180 NOT NULL,
	"finding_retention_days" integer DEFAULT 365 NOT NULL,
	"alert_retention_days" integer DEFAULT 365 NOT NULL,
	"alert_min_severity" "incident_severity" DEFAULT 'High' NOT NULL,
	"unknown_source_enabled" boolean DEFAULT true NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_endpoint_url" text,
	"ai_api_key" text,
	"ai_model_opus" text,
	"ai_model_sonnet" text,
	"ai_model_haiku" text,
	"ai_default_model" text,
	"ai_max_sample_events" integer DEFAULT 5 NOT NULL,
	"ai_max_raw_length" integer DEFAULT 2000 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "syslog_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_event_id" integer NOT NULL,
	"event_time" timestamp,
	"received_at" timestamp NOT NULL,
	"source_ip" text NOT NULL,
	"hostname" text,
	"facility" integer,
	"severity" integer,
	"priority" integer,
	"app_name" text,
	"program" text,
	"process_id" text,
	"message" text NOT NULL,
	"site_id" integer,
	"device_id" integer,
	"source_id" integer,
	"vendor" "syslog_vendor",
	"parser" text NOT NULL,
	"category" text,
	"normalized_type" text,
	"action" text,
	"outcome" text,
	"src_ip" text,
	"src_port" integer,
	"dst_ip" text,
	"dst_port" integer,
	"username" text,
	"interface_name" text,
	"protocol" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "syslog_events_raw" (
	"id" serial PRIMARY KEY NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"source_ip" text NOT NULL,
	"source_port" integer NOT NULL,
	"transport" "syslog_transport" DEFAULT 'udp' NOT NULL,
	"raw_message" text NOT NULL,
	"raw_size" integer NOT NULL,
	"ingest_status" "syslog_ingest_status" DEFAULT 'received' NOT NULL,
	"parse_error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "syslog_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"device_id" integer,
	"source_ip" text NOT NULL,
	"hostname" text,
	"display_name" text NOT NULL,
	"vendor" "syslog_vendor" DEFAULT 'generic' NOT NULL,
	"product" text,
	"parser_profile" text DEFAULT 'generic' NOT NULL,
	"trust_level" "syslog_trust_level" DEFAULT 'unknown' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp,
	"event_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "siem_alerts" ADD CONSTRAINT "siem_alerts_finding_id_siem_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."siem_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_rule_id_siem_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."siem_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD CONSTRAINT "siem_findings_created_incident_id_incidents_id_fk" FOREIGN KEY ("created_incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD CONSTRAINT "siem_settings_default_siem_site_id_sites_id_fk" FOREIGN KEY ("default_siem_site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_raw_event_id_syslog_events_raw_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."syslog_events_raw"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_sources" ADD CONSTRAINT "syslog_sources_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syslog_sources" ADD CONSTRAINT "syslog_sources_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "siem_alerts_finding_idx" ON "siem_alerts" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "siem_alerts_status_created_idx" ON "siem_alerts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "siem_findings_status_severity_last_seen_idx" ON "siem_findings" USING btree ("status","severity","last_seen_at");--> statement-breakpoint
CREATE INDEX "siem_findings_site_status_severity_idx" ON "siem_findings" USING btree ("site_id","status","severity");--> statement-breakpoint
CREATE INDEX "siem_findings_device_status_idx" ON "siem_findings" USING btree ("device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "siem_findings_rule_correlation_unique" ON "siem_findings" USING btree ("rule_id","correlation_key");--> statement-breakpoint
CREATE INDEX "siem_rules_enabled_idx" ON "siem_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "siem_rules_category_idx" ON "siem_rules" USING btree ("category");--> statement-breakpoint
CREATE INDEX "siem_rules_severity_idx" ON "siem_rules" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "syslog_events_received_at_idx" ON "syslog_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_site_received_idx" ON "syslog_events" USING btree ("site_id","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_device_received_idx" ON "syslog_events" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_source_received_idx" ON "syslog_events" USING btree ("source_ip","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_normalized_received_idx" ON "syslog_events" USING btree ("normalized_type","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_severity_received_idx" ON "syslog_events" USING btree ("severity","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_category_received_idx" ON "syslog_events" USING btree ("category","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_received_at_idx" ON "syslog_events_raw" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_source_received_idx" ON "syslog_events_raw" USING btree ("source_ip","received_at");--> statement-breakpoint
CREATE INDEX "syslog_events_raw_status_received_idx" ON "syslog_events_raw" USING btree ("ingest_status","received_at");--> statement-breakpoint
CREATE INDEX "syslog_sources_site_source_ip_idx" ON "syslog_sources" USING btree ("site_id","source_ip");--> statement-breakpoint
CREATE INDEX "syslog_sources_source_ip_idx" ON "syslog_sources" USING btree ("source_ip");--> statement-breakpoint
CREATE INDEX "syslog_sources_hostname_idx" ON "syslog_sources" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "syslog_sources_device_id_idx" ON "syslog_sources" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "syslog_sources_enabled_idx" ON "syslog_sources" USING btree ("enabled");