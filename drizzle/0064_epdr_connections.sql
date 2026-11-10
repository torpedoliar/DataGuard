-- Per-site WatchGuard EPDR connection + superadmin global controls (T02).
-- One active connection per site (site_id UNIQUE) and one binding per
-- (region, account_id). Credential secrets (api_key and access passwords) are
-- encrypted at rest with lib/crypto.ts AES-256-GCM; access ids are identifiers
-- and stored plaintext. Credential/account changes bump their revision columns
-- so cached tokens/tests invalidate and queued old-account commands are
-- recognized as stale (CONTRACTS C1).
CREATE TABLE IF NOT EXISTS "watchguard_connections" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL UNIQUE REFERENCES "sites"("id") ON DELETE cascade,
    "enabled" boolean NOT NULL DEFAULT false,
    "region" text NOT NULL CHECK ("region" IN ('jpn', 'deu', 'usa')),
    "account_id" text NOT NULL,
    "api_key" text,
    "rw_access_id" text,
    "rw_password" text,
    "ro_access_id" text,
    "ro_password" text,
    "endpoint_sync_minutes" integer NOT NULL DEFAULT 15,
    "detection_sync_minutes" integer NOT NULL DEFAULT 5,
    "credential_revision" integer NOT NULL DEFAULT 0,
    "account_revision" integer NOT NULL DEFAULT 0,
    "last_test_at" timestamp,
    "last_test_result" jsonb,
    "last_endpoint_sync_at" timestamp,
    "last_detection_sync_at" timestamp,
    "last_sync_error" text,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    CONSTRAINT "watchguard_connections_intervals_check" CHECK (
        "endpoint_sync_minutes" BETWEEN 5 AND 1440
        AND "detection_sync_minutes" BETWEEN 2 AND 60
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "watchguard_connections_region_account_idx"
    ON "watchguard_connections" ("region", "account_id");

-- Singleton row (id = 1) for superadmin-global EPDR controls. allowed_actions
-- is the ceiling every site inherits (values from lib/epdr/action-types.ts).
CREATE TABLE IF NOT EXISTS "watchguard_global_settings" (
    "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
    "kill_switch" boolean NOT NULL DEFAULT false,
    "allowed_actions" text[] NOT NULL DEFAULT ARRAY['scan']::text[],
    "max_actions_per_hour_per_site" integer NOT NULL DEFAULT 30,
    "simulation_min_days" integer NOT NULL DEFAULT 7,
    "auto_close_categories" text[] NOT NULL DEFAULT ARRAY['malware', 'pup']::text[],
    "auto_close_max_score" integer NOT NULL DEFAULT 6,
    "approval_expiry_hours" integer NOT NULL DEFAULT 24,
    "exclusion_max_days" integer NOT NULL DEFAULT 90,
    "updated_by" integer REFERENCES "users"("id"),
    "updated_at" timestamp DEFAULT now()
);

INSERT INTO "watchguard_global_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;