-- Detection ingest + site settings (T05). Two intake paths (security events
-- export + ThreatSync incidents) normalize to epdr_detections and correlate
-- into one DC Incident per endpoint+threat episode. No provider writes here.

CREATE TABLE IF NOT EXISTS "epdr_site_settings" (
    "site_id" integer PRIMARY KEY REFERENCES "sites"("id") ON DELETE cascade,
    "ingest_enabled" boolean NOT NULL DEFAULT false,
    "event_types" integer[] NOT NULL DEFAULT ARRAY[1,2,4,6,18],
    "threatsync_enabled" boolean NOT NULL DEFAULT true,
    "threatsync_categories" text[] NOT NULL DEFAULT ARRAY['malware','pup','virus','exploit','ioa'],
    "threatsync_min_score" integer NOT NULL DEFAULT 7,
    "threatsync_max_score" integer NOT NULL DEFAULT 10,
    "default_severity" jsonb NOT NULL DEFAULT '{"1":"High","2":"Medium","4":"High","6":"High","18":"High"}',
    "correlation_window_minutes" integer NOT NULL DEFAULT 1440,
    "reopen_window_days" integer NOT NULL DEFAULT 7,
    "default_assignee_id" integer REFERENCES "users"("id") ON DELETE set null,
    "site_kill_switch" boolean NOT NULL DEFAULT false,
    "automation_paused_at" timestamp,
    "automation_paused_reason" text,
    "updated_by" integer REFERENCES "users"("id"),
    "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "epdr_detections" (
    "id" serial PRIMARY KEY,
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id") ON DELETE cascade,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "source" text NOT NULL CHECK ("source" IN ('event_export','threatsync')),
    "source_key" text NOT NULL,
    "endpoint_id" integer REFERENCES "epdr_endpoints"("id") ON DELETE set null,
    "category" text NOT NULL,
    "provider_type" text,
    "threat_name" text,
    "file_path" text,
    "md5" text,
    "threat_score" integer,
    "severity" text NOT NULL,
    "detected_at" timestamp NOT NULL,
    "ts_incident_id" text,
    "ts_status" text,
    "ts_remediated" boolean,
    "ts_last_update_at" timestamp,
    "incident_id" integer REFERENCES "incidents"("id") ON DELETE set null,
    "ignored_reason" text,
    "raw" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    UNIQUE ("connection_id", "source", "source_key")
);

CREATE INDEX IF NOT EXISTS "epdr_detections_endpoint_time_idx" ON "epdr_detections" ("endpoint_id", "detected_at");
CREATE INDEX IF NOT EXISTS "epdr_detections_incident_idx" ON "epdr_detections" ("incident_id");

CREATE TABLE IF NOT EXISTS "epdr_workflows" (
    "incident_id" integer PRIMARY KEY REFERENCES "incidents"("id") ON DELETE cascade,
    "site_id" integer NOT NULL REFERENCES "sites"("id"),
    "endpoint_id" integer REFERENCES "epdr_endpoints"("id") ON DELETE set null,
    "state" text NOT NULL DEFAULT 'detected' CHECK ("state" IN ('detected','awaiting_approval','dispatching','in_progress','waiting_endpoint','verifying','resolved','needs_review','held','simulated','awaiting_close_approval','ready_for_manual_close')),
    "kind" text NOT NULL DEFAULT 'threat' CHECK ("kind" IN ('threat','health')),
    "threat_key" text NOT NULL,
    "evidence_generation" integer NOT NULL DEFAULT 0,
    "last_detection_at" timestamp NOT NULL,
    "reopen_count" integer NOT NULL DEFAULT 0,
    "updated_at" timestamp DEFAULT now()
);

-- One record per provider incident (unique per connection + ThreatSync id) and
-- one target per entity (CONTRACTS C3). Never encode multi-entity closure in a
-- single incidents column.
CREATE TABLE IF NOT EXISTS "epdr_provider_incidents" (
    "id" serial PRIMARY KEY,
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id") ON DELETE cascade,
    "ts_incident_id" text NOT NULL,
    "provider_status" text,
    "evidence_fingerprint" text,
    "complete_sync_revision" integer NOT NULL DEFAULT 0,
    "raw" jsonb,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    UNIQUE ("connection_id", "ts_incident_id")
);

CREATE TABLE IF NOT EXISTS "epdr_provider_incident_targets" (
    "id" serial PRIMARY KEY,
    "provider_incident_id" integer NOT NULL REFERENCES "epdr_provider_incidents"("id") ON DELETE cascade,
    "entity_id" text NOT NULL,
    "endpoint_id" integer REFERENCES "epdr_endpoints"("id") ON DELETE set null,
    "incident_id" integer REFERENCES "incidents"("id") ON DELETE set null,
    "classification" text NOT NULL DEFAULT 'unreviewed',
    "review_state" text NOT NULL DEFAULT 'unreviewed',
    "raw" jsonb,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    UNIQUE ("provider_incident_id", "entity_id")
);