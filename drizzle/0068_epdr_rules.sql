-- Response rules + simulation (T06). A rule is versioned (rule_key stable, one
-- is_current); editing inserts a new version. Evaluations record the decision
-- per incident + rule version + trigger detection exactly once.

CREATE TABLE IF NOT EXISTS "epdr_rules" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "rule_key" uuid NOT NULL,
    "version" integer NOT NULL,
    "is_current" boolean NOT NULL DEFAULT true,
    "name" text NOT NULL,
    "enabled" boolean NOT NULL DEFAULT false,
    "trigger" text NOT NULL DEFAULT 'detection',
    "categories" text[] NOT NULL DEFAULT '{}',
    "min_score" integer,
    "max_score" integer,
    "device_types" integer[] NOT NULL DEFAULT ARRAY[1,2],
    "action_type" text NOT NULL,
    "action_params" jsonb NOT NULL DEFAULT '{}',
    "execution_mode" text NOT NULL DEFAULT 'simulate',
    "close_mode" text NOT NULL DEFAULT 'manual',
    "observation_minutes" integer NOT NULL DEFAULT 30,
    "cooldown_minutes" integer NOT NULL DEFAULT 240,
    "priority" integer NOT NULL DEFAULT 100,
    "simulate_since" timestamp,
    "pending_mode" text,
    "pending_mode_requested_by" integer REFERENCES "users"("id"),
    "pending_mode_requested_at" timestamp,
    "created_by" integer REFERENCES "users"("id"),
    "created_at" timestamp DEFAULT now(),
    UNIQUE ("rule_key", "version")
);

CREATE UNIQUE INDEX IF NOT EXISTS "epdr_rules_current_idx" ON "epdr_rules" ("rule_key") WHERE "is_current";

CREATE TABLE IF NOT EXISTS "epdr_rule_evaluations" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "incident_id" integer NOT NULL REFERENCES "incidents"("id") ON DELETE cascade,
    "endpoint_id" integer REFERENCES "epdr_endpoints"("id") ON DELETE set null,
    "rule_id" integer REFERENCES "epdr_rules"("id"),
    "trigger_detection_id" integer REFERENCES "epdr_detections"("id"),
    "decision" text NOT NULL,
    "effective_mode" text,
    "reasons" jsonb NOT NULL,
    "action_id" integer,
    "next_evaluate_at" timestamp,
    "created_at" timestamp DEFAULT now(),
    UNIQUE ("incident_id", "rule_id", "trigger_detection_id")
);

-- Two disabled simulation templates per site (seeded on first run); operators
-- enable and, after the configured simulation minimum, request automatic mode.
INSERT INTO "epdr_rules"
    ("site_id", "rule_key", "version", "is_current", "name", "enabled", "trigger",
     "categories", "min_score", "max_score", "device_types", "action_type",
     "action_params", "execution_mode", "close_mode", "observation_minutes",
     "cooldown_minutes", "priority", "simulate_since")
SELECT s."id",
       '00000000-0000-4000-8000-000000000001',
       1, true,
       'Activity Malware/PUP/Exploit -> FULL scan',
       false, 'detection',
       ARRAY['malware','pup','exploit'], NULL, NULL, ARRAY[1,2], 'scan',
       '{"scanScope":0,"windowHours":24}', 'simulate', 'manual', 30, 240, 100, now()
FROM "sites" s
WHERE NOT EXISTS (SELECT 1 FROM "epdr_rules" r WHERE r."rule_key" = '00000000-0000-4000-8000-000000000001' AND r."site_id" = s."id");

INSERT INTO "epdr_rules"
    ("site_id", "rule_key", "version", "is_current", "name", "enabled", "trigger",
     "categories", "min_score", "max_score", "device_types", "action_type",
     "action_params", "execution_mode", "close_mode", "observation_minutes",
     "cooldown_minutes", "priority", "simulate_since")
SELECT s."id",
       '00000000-0000-4000-8000-000000000002',
       1, true,
       'Scored IOA/Malware/PUP/Virus/Exploit 7-10 -> FULL scan',
       false, 'detection',
       ARRAY['malware','pup','virus','exploit','ioa'], 7, 10, ARRAY[1,2], 'scan',
       '{"scanScope":0,"windowHours":24}', 'simulate', 'manual', 30, 240, 90, now()
FROM "sites" s
WHERE NOT EXISTS (SELECT 1 FROM "epdr_rules" r WHERE r."rule_key" = '00000000-0000-4000-8000-000000000002' AND r."site_id" = s."id");