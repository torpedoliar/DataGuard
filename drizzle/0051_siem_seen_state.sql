-- SIEM first_seen state (P1): per-site, per-rule seen-state for generic
-- first_seen rules. One row per (rule, group_key, group_value): the first
-- time that entity value was observed. A first_seen rule fires when an event's
-- group value has no row yet — the insert here is the state write.

CREATE TABLE IF NOT EXISTS "siem_seen_state" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id"),
    "rule_id" integer NOT NULL REFERENCES "siem_rules"("id") ON DELETE CASCADE,
    "group_key" text NOT NULL,
    "group_value" text NOT NULL,
    "first_seen_at" timestamp with time zone NOT NULL,
    "last_seen_at" timestamp with time zone NOT NULL,
    "seen_count" integer NOT NULL DEFAULT 1,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "siem_seen_state_lookup_idx" ON "siem_seen_state" ("site_id", "rule_id", "group_key");
CREATE UNIQUE INDEX IF NOT EXISTS "siem_seen_state_unique" ON "siem_seen_state" ("site_id", "rule_id", "group_key", "group_value");
