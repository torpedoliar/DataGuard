-- SIEM multi-site: contract phase (part 2 / 1b). Run AFTER 0024 (1a) has shipped
-- and every site_id is backfilled. This migration tightens the nullable columns to
-- NOT NULL, drops the global single-tenant constraints, creates the per-site
-- unique constraints/indexes, drops the dead default_siem_site_id + unknown_source_enabled
-- columns, and seeds per-site default rules + a siem_settings row for any site missing them.
--
-- Registered in meta/_journal.json (idx 25) and applied automatically by
-- `npm run db:migrate` (scripts/migrate.ts), exactly like 0024. The migration
-- is idempotent (guarded DDL + WHERE-limited backfills), so re-running it via
-- the migrator or psql is safe.

-- ==================== DROP old global single-tenant constraints ====================
-- siem_rules.key was globally unique (a UNIQUE CONSTRAINT from the .unique() col
-- attribute, NOT a uniqueIndex) — must DROP CONSTRAINT, not DROP INDEX. Postgres
-- rejects DROP INDEX on the backing index of a constraint (error 2BP01).
-- Now uniqueness is (site_id, key) via uniqueIndex below.
ALTER TABLE "siem_rules" DROP CONSTRAINT IF EXISTS "siem_rules_key_unique";--> statement-breakpoint
-- siem_findings correlation was globally unique on (rule_id, correlation_key);
-- this one IS a uniqueIndex, so DROP INDEX is correct.
-- Now (site_id, rule_id, correlation_key) so findings never collide across sites.
DROP INDEX IF EXISTS "siem_findings_rule_correlation_unique";--> statement-breakpoint

-- ==================== DROP dead columns ====================
ALTER TABLE "siem_settings" DROP COLUMN IF EXISTS "default_siem_site_id";--> statement-breakpoint
ALTER TABLE "siem_settings" DROP COLUMN IF EXISTS "unknown_source_enabled";--> statement-breakpoint

-- ==================== CREATE per-site constraints + indexes ====================
-- Source IP is globally unique (one syslog listener, source IP identifies the device).
CREATE UNIQUE INDEX IF NOT EXISTS "syslog_sources_source_ip_unique" ON "syslog_sources" USING btree ("source_ip");--> statement-breakpoint
-- Per-site rule key uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS "siem_rules_site_key_unique" ON "siem_rules" USING btree ("site_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_rules_site_enabled_idx" ON "siem_rules" USING btree ("site_id","enabled");--> statement-breakpoint
-- Per-site finding correlation isolation.
CREATE UNIQUE INDEX IF NOT EXISTS "siem_findings_site_rule_correlation_unique" ON "siem_findings" USING btree ("site_id","rule_id","correlation_key");--> statement-breakpoint
-- One siem_settings row per site.
CREATE UNIQUE INDEX IF NOT EXISTS "siem_settings_site_unique" ON "siem_settings" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_events_quarantine_site_quarantined_idx" ON "siem_events_quarantine" USING btree ("site_id","quarantined_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_dashboard_snapshots_site_captured_idx" ON "siem_dashboard_snapshots" USING btree ("site_id","captured_at");--> statement-breakpoint

-- ==================== SET NOT NULL ====================
-- 1a backfilled every NULL (fallback = min active site id). These are now safe.
-- syslog_events_raw.site_id stays NULLABLE: the receiver writes raw rows before any
-- source/site match (it only knows sourceIp); the parser worker stamps siteId on
-- parse. See schema.ts ponytail comment for the ceiling + upgrade path.
ALTER TABLE "syslog_sources" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "syslog_events" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "siem_rules" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "siem_findings" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "siem_settings" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "siem_events_quarantine" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "siem_dashboard_snapshots" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint

-- ==================== Per-site seed ====================
-- Seed the default rules for every site that lacks them. The DISTINCT ON (key)
-- picks one canonical copy of each rule key from the pre-multi-site global rows;
-- the NOT EXISTS guard skips sites already seeded (by addSite or the rule worker).
INSERT INTO "siem_rules" (
  "site_id", "key", "name", "description", "enabled", "severity", "category",
  "rule_type", "conditions", "group_by", "threshold", "window_seconds",
  "cooldown_seconds", "alert_enabled", "created_at", "updated_at"
)
SELECT s.id, r.key, r.name, r.description, r.enabled, r.severity, r.category,
       r.rule_type, r.conditions, r.group_by, r.threshold, r.window_seconds,
       r.cooldown_seconds, r.alert_enabled, now(), now()
FROM "sites" s
CROSS JOIN (
  SELECT DISTINCT ON ("key") key, name, description, enabled, severity, category,
    rule_type, conditions, group_by, threshold, window_seconds, cooldown_seconds, alert_enabled
  FROM "siem_rules"
  ORDER BY "key", "id"
) r
WHERE NOT EXISTS (SELECT 1 FROM "siem_rules" x WHERE x.site_id = s.id AND x.key = r.key);--> statement-breakpoint

-- Seed a siem_settings row for every site that lacks one. Copy the non-dropped
-- columns from an existing settings row (any one); fall back to schema defaults
-- when no settings row exists yet (fresh deploy).
INSERT INTO "siem_settings" (
  "site_id", "udp_port", "tcp_port", "tls_port", "tls_cert_path", "tls_key_path",
  "max_message_size", "queue_limit", "batch_size", "flush_interval_ms",
  "raw_retention_days", "event_retention_days", "finding_retention_days", "alert_retention_days",
  "alert_min_severity", "quarantine_enabled", "quarantine_retention_days",
  "ai_enabled", "ai_endpoint_url", "ai_api_key", "ai_default_model",
  "ai_max_sample_events", "ai_max_raw_length", "ai_regenerate_cooldown_sec",
  "created_at", "updated_at"
)
SELECT s.id,
  COALESCE((SELECT udp_port FROM siem_settings LIMIT 1), 514),
  (SELECT tcp_port FROM siem_settings LIMIT 1),
  (SELECT tls_port FROM siem_settings LIMIT 1),
  (SELECT tls_cert_path FROM siem_settings LIMIT 1),
  (SELECT tls_key_path FROM siem_settings LIMIT 1),
  COALESCE((SELECT max_message_size FROM siem_settings LIMIT 1), 16384),
  COALESCE((SELECT queue_limit FROM siem_settings LIMIT 1), 1000),
  COALESCE((SELECT batch_size FROM siem_settings LIMIT 1), 100),
  COALESCE((SELECT flush_interval_ms FROM siem_settings LIMIT 1), 1000),
  COALESCE((SELECT raw_retention_days FROM siem_settings LIMIT 1), 90),
  COALESCE((SELECT event_retention_days FROM siem_settings LIMIT 1), 180),
  COALESCE((SELECT finding_retention_days FROM siem_settings LIMIT 1), 365),
  COALESCE((SELECT alert_retention_days FROM siem_settings LIMIT 1), 365),
  COALESCE((SELECT alert_min_severity FROM siem_settings LIMIT 1), 'High'),
  COALESCE((SELECT quarantine_enabled FROM siem_settings LIMIT 1), true),
  COALESCE((SELECT quarantine_retention_days FROM siem_settings LIMIT 1), 365),
  COALESCE((SELECT ai_enabled FROM siem_settings LIMIT 1), false),
  (SELECT ai_endpoint_url FROM siem_settings LIMIT 1),
  (SELECT ai_api_key FROM siem_settings LIMIT 1),
  (SELECT ai_default_model FROM siem_settings LIMIT 1),
  COALESCE((SELECT ai_max_sample_events FROM siem_settings LIMIT 1), 5),
  COALESCE((SELECT ai_max_raw_length FROM siem_settings LIMIT 1), 2000),
  COALESCE((SELECT ai_regenerate_cooldown_sec FROM siem_settings LIMIT 1), 3600),
  now(), now()
FROM "sites" s
WHERE NOT EXISTS (SELECT 1 FROM "siem_settings" x WHERE x.site_id = s.id);
