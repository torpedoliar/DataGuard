-- SIEM IOC watchlist (P0 gap analysis): indicators to match against events.
-- Per-site like siem_rules. value matching is exact for ip, case-insensitive
-- for domain/hash. The indicator_match rule type (0050) reads this table.

CREATE TABLE IF NOT EXISTS "siem_iocs" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id"),
    "type" text NOT NULL,
    "value" text NOT NULL,
    "description" text,
    "severity" "incident_severity" NOT NULL DEFAULT 'High',
    "enabled" boolean NOT NULL DEFAULT true,
    "expires_at" timestamp with time zone,
    "created_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "siem_iocs_site_type_idx" ON "siem_iocs" ("site_id", "type");
CREATE INDEX IF NOT EXISTS "siem_iocs_site_enabled_idx" ON "siem_iocs" ("site_id", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "siem_iocs_site_type_value_unique" ON "siem_iocs" ("site_id", "type", "value");
