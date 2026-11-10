-- Verification / auto-close / circuit breaker / exclusions (T08).

ALTER TABLE "epdr_workflows"
    ADD COLUMN "verification_started_at" timestamp,
    ADD COLUMN "rescan_count" integer NOT NULL DEFAULT 0,
    ADD COLUMN "close_decision" jsonb,
    ADD COLUMN "ts_sync_state" text;

CREATE TABLE IF NOT EXISTS "epdr_exclusions" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "match_md5" text,
    "match_threat_name" text,
    "endpoint_id" integer REFERENCES "epdr_endpoints"("id") ON DELETE cascade,
    "reason" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_by" integer NOT NULL REFERENCES "users"("id"),
    "created_at" timestamp DEFAULT now(),
    CHECK ("match_md5" IS NOT NULL OR "match_threat_name" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "epdr_exclusions_md5_idx" ON "epdr_exclusions" ("site_id", "match_md5") WHERE "match_md5" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "epdr_exclusions_name_idx" ON "epdr_exclusions" ("site_id", "match_threat_name") WHERE "match_threat_name" IS NOT NULL;

ALTER TABLE "epdr_site_settings"
    ADD COLUMN "breaker_max_actions" integer NOT NULL DEFAULT 20,
    ADD COLUMN "breaker_window_minutes" integer NOT NULL DEFAULT 15,
    ADD COLUMN "breaker_same_threat_endpoints" integer NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS "epdr_campaigns" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "threat_key" text NOT NULL,
    "window_key" text NOT NULL,
    "started_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now(),
    UNIQUE ("site_id", "threat_key", "window_key")
);