-- Protection health ladder (T09). One open case per endpoint; the ladder
-- classifies protection problems, grants grace/transient windows, proposes
-- reboot where a policy enables it, and otherwise escalates to manual-repair
-- Incidents. No repair/reinstall endpoint exists in the public API.

CREATE TABLE IF NOT EXISTS "epdr_health_cases" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "endpoint_id" integer NOT NULL REFERENCES "epdr_endpoints"("id") ON DELETE cascade,
    "problem" text NOT NULL,
    "stage" integer NOT NULL DEFAULT 0,
    "opened_at" timestamp NOT NULL,
    "stage_changed_at" timestamp NOT NULL,
    "last_status" jsonb NOT NULL,
    "incident_id" integer REFERENCES "incidents"("id") ON DELETE set null,
    "reboot_action_id" integer REFERENCES "epdr_actions"("id"),
    "healthy_since" timestamp,
    "closed_at" timestamp,
    "close_reason" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "epdr_health_cases_open_idx" ON "epdr_health_cases" ("endpoint_id") WHERE "closed_at" IS NULL;

ALTER TABLE "epdr_site_settings"
    ADD COLUMN "health_enabled" boolean NOT NULL DEFAULT false,
    ADD COLUMN "health_grace_minutes" integer NOT NULL DEFAULT 30,
    ADD COLUMN "health_stage_wait_hours" integer NOT NULL DEFAULT 24,
    ADD COLUMN "health_reboot_mode" text NOT NULL DEFAULT 'approval',
    ADD COLUMN "health_reboot_countdown" integer NOT NULL DEFAULT 7,
    ADD COLUMN "health_stable_minutes" integer NOT NULL DEFAULT 60;