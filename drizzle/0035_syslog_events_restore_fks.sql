-- 0035_syslog_events_restore_fks.sql
-- Finding #41: migration 0016 converted syslog_events to a partitioned table by
-- creating a partitioned twin without ANY foreign keys and renaming the old
-- table away — dropping all four FKs that 0005 had created
-- (raw_event_id, site_id, device_id, source_id). This migration recreates the
-- three LEGAL referencing-side FKs.
--
-- The raw_event_id FK (syslog_events.raw_event_id -> syslog_events_raw.id) is
-- intentionally NOT recreated: PostgreSQL forbids a regular FK referencing a
-- partitioned table (syslog_events_raw is partitioned since 0016), so it can
-- never exist again. db/schema.ts declares raw_event_id as a plain integer
-- (no .references()/relation) and the application layer maintains the
-- reference (lib/siem/evidence.ts).
--
-- Referencing-side FKs on a partitioned table ARE supported; only the
-- referenced side must not be partitioned (sites, devices, syslog_sources are
-- regular tables). The constraint definitions match the originals from 0005
-- (ON DELETE no action ON UPDATE no action), consistent with db/schema.ts.
--
-- PostgreSQL has no CREATE CONSTRAINT IF NOT EXISTS, so each FK is guarded by
-- a DO block checking pg_constraint (same pattern as 0024/0032).
--
-- Assumption: no orphaned rows accumulated while the FKs were missing (0016
-- dropped them, so nothing enforced site_id/device_id/source_id afterwards).
-- Because a plain ADD CONSTRAINT would fail on such rows anyway, each block
-- pre-counts orphans and raises a clear error instead of a raw FK violation.

BEGIN;--> statement-breakpoint

-- site_id → sites
DO $$
DECLARE
  orphan_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'syslog_events'::regclass
      AND conname = 'syslog_events_site_id_sites_id_fk'
  ) THEN
    SELECT count(*) INTO orphan_count
    FROM syslog_events e
    LEFT JOIN sites s ON s.id = e.site_id
    WHERE s.id IS NULL;
    IF orphan_count > 0 THEN
      RAISE EXCEPTION
        'syslog_events has % row(s) with a dangling site_id — resolve them before re-adding FK syslog_events_site_id_sites_id_fk',
        orphan_count;
    END IF;
    ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_site_id_sites_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- device_id REFERENCES devices
DO $$ DECLARE
  orphan_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'syslog_events'::regclass
      AND conname = 'syslog_events_device_id_devices_id_fk'
  ) THEN
    SELECT count(*) INTO orphan_count
    FROM syslog_events e
    LEFT JOIN devices d ON d.id = e.device_id
    WHERE e.device_id IS NOT NULL AND d.id IS NULL;
    IF orphan_count > 0 THEN
      RAISE EXCEPTION
        'syslog_events has % row(s) with a dangling device_id — resolve them before re-adding FK syslog_events_device_id_devices_id_fk',
        orphan_count;
    END IF;
    ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_device_id_devices_id_fk"
      FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- source_id -> syslog_sources
DO $$ DECLARE
  orphan_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'syslog_events'::regclass
      AND conname = 'syslog_events_source_id_syslog_sources_id_fk'
  ) THEN
    SELECT count(*) INTO orphan_count
    FROM syslog_events e
    LEFT JOIN syslog_sources s ON s.id = e.source_id
    WHERE e.source_id IS NOT NULL AND s.id IS NULL;
    IF orphan_count > 0 THEN
      RAISE EXCEPTION
        'syslog_events has % row(s) with a dangling source_id — resolve them before re-adding FK syslog_events_source_id_syslog_sources_id_fk',
        orphan_count;
    END IF;
    ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_source_id_syslog_sources_id_fk"
      FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

COMMIT;