-- scripts/audit-site-backfill.sql
-- Finding #42: migration 0024 backfilled NULL site_id rows whose source
-- mapping could not be resolved with the MIN active site id, and 0025 then
-- locked those columns NOT NULL — so mis-attributed rows are now permanent
-- and indistinguishable from genuine data at that site.
--
-- This script is a READ-ONLY review aid, not a migration. It selects rows that
-- are plausibly fallback-assigned so an operator can inspect and correct them
-- manually before the data pollutes dashboards/retention/alert routing for
-- good. No INSERT/UPDATE/DELETE anywhere in this file.
--
-- Run against the deployment database:
--   psql "$DATABASE_URL" -f scripts/audit-site-backfill.sql
--
-- How to read the results: every query flags rows sitting on the fallback
-- site (min(id) of active sites) whose original source mapping still cannot be
-- resolved today (unmatched source_ip / missing event / missing source). Those
-- rows were almost certainly assigned by 0024's fallback rather than by real
-- data mapping. The siem_rules/siem_settings queries are broader: 0024 had no
-- mapping for them, so EVERY legacy NULL row landed on the fallback site.

-- The fallback site id exactly as 0024 computed it.
WITH fallback_site AS (
  SELECT min(id) AS id FROM sites WHERE is_active = true
)

-- 1) syslog_events_raw rows on the fallback site whose source_ip matches no
--    syslog_sources row — 0024's second UPDATE could not map them, so they
--    fell back. (The parser worker re-stamps site_id on parse, so a row here
--    is one that was never re-stamped either.)
SELECT 'syslog_events_raw' AS table_name, id, source_ip, site_id, received_at,
       'source_ip unmatched by syslog_sources — fallback-assigned by 0024' AS reason
FROM syslog_events_raw r
WHERE r.site_id = (SELECT id FROM fallback_site)
  AND NOT EXISTS (SELECT 1 FROM syslog_sources s WHERE s.source_ip = r.source_ip);

-- 2) siem_events_quarantine rows on the fallback site whose original_event_id
--    points at no syslog_events row — 0024's event lookup failed, fallback used.
SELECT 'siem_events_quarantine' AS table_name, id, original_event_id, source_ip,
       site_id, quarantined_at,
       'original_event_id not found in syslog_events — fallback-assigned by 0024' AS reason
FROM siem_events_quarantine q
WHERE q.site_id = (SELECT id FROM fallback_site)
  AND NOT EXISTS (SELECT 1 FROM syslog_events e WHERE e.id = q.original_event_id);

-- 3) siem_findings on the fallback site whose first sample event and source
--    are both unresolvable — 0024's COALESCE chain ended in the fallback.
WITH fallback_site AS (
  SELECT min(id) AS id FROM sites WHERE is_active = true
)
SELECT f.id, f.title, f.site_id, f.severity, f.first_seen_at, f.sample_event_ids,
       'no sample event and no source mapping — fallback-assigned by 0024' AS reason
FROM siem_findings f
WHERE f.site_id = (SELECT id FROM fallback_site)
  AND (
        (f.sample_event_ids IS NULL OR f.sample_event_ids = '[]'::jsonb)
        OR NOT EXISTS (
            SELECT 1 FROM syslog_events e
            WHERE e.id = (f.sample_event_ids->0)::int
        )
      )
  AND (
        f.source_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM syslog_sources s WHERE s.id = f.source_id)
      );

-- 4) siem_rules on the fallback site: 0024 had no mapping for rules, so every
--    legacy (pre-tenancy) rule landed on the fallback site. 0025 later seeded
--    identical rules for every site, so these rows are likely the original
--    global copies — candidates for keeping-only-if-intended or removal.
--    Read-only: review, do not delete blindly.
WITH fallback_site AS (
  SELECT min(id) AS id FROM sites WHERE is_active = true
)
SELECT id, key, name, severity, enabled, alert_enabled, site_id, created_at,
       'legacy global rule attributed to fallback site by 0024 — verify intent' AS reason
FROM siem_rules
WHERE site_id = (SELECT id FROM fallback_site)
ORDER BY key, id;

-- 5) siem_settings on the fallback site: same story — 0024 set every legacy
--    settings row to the fallback site (0025 then seeded the other sites).
WITH fallback_site AS (
  SELECT min(id) AS id FROM sites WHERE is_active = true
)
SELECT id, site_id, udp_port, tcp_port, alert_min_severity, created_at
FROM siem_settings
WHERE site_id = (SELECT id FROM fallback_site);

-- Summary: rows with `reason LIKE 'fallback%'` above are the ones 0024 could
-- not attribute. Rows whose source mapping NOW resolves (e.g. a syslog_source
-- was configured after the upgrade) are safe to UPDATE to the correct
-- site_id; the genuinely unmapped ones need a human decision.