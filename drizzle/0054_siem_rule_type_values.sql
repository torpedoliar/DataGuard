-- siem_rule_type enum values for the new rule types (indicator_match 0050,
-- first_seen 0051). The schema (db/schema.ts) already declares them; without
-- this the seed of default rules fails with enum_in and the rule worker
-- crash-loops. ALTER TYPE ADD VALUE cannot run inside a transaction block in
-- older Postgres; drizzle runs each statement with breakpoints, and Postgres 12+
-- allows it in a transaction, but keep the guard idempotent anyway.
ALTER TYPE "siem_rule_type" ADD VALUE IF NOT EXISTS 'indicator_match';--> statement-breakpoint
ALTER TYPE "siem_rule_type" ADD VALUE IF NOT EXISTS 'first_seen';
