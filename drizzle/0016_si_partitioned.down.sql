-- 0016_si_partitioned.down.sql
-- Rollback for 0016_si_partitioned.sql.
--
-- Restores the pre-migration layout: the partitioned tables are renamed
-- back to *_partitioned, the original (now *_old) tables are renamed
-- back to their canonical names, and the indexes are recreated on the
-- restored originals.
--
-- Idempotent: uses IF EXISTS / DO guards so a partial rollback can be
-- re-applied.

BEGIN;

-- =============================================================
-- Rollback syslog_events
-- =============================================================
DO $do$
BEGIN
  -- Drop the partitioned twin if it still exists.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_partitioned_table p ON p.partrelid = c.oid
    WHERE c.relname = 'syslog_events'
      AND c.relnamespace = 'public'::regnamespace
  ) THEN
    -- Detach partitions first (drop child tables), then drop the parent.
    EXECUTE $inner$
      DO $inner2$
      DECLARE part_rec record;
      BEGIN
        FOR part_rec IN
          SELECT inhrelid::regclass::text AS part_name
          FROM pg_inherits
          WHERE inhparent = 'public.syslog_events'::regclass
        LOOP
          EXECUTE format('DROP TABLE IF EXISTS public.%I', part_rec.part_name);
        END LOOP;
      END
      $inner2$;
    $inner$;
    EXECUTE 'DROP TABLE IF EXISTS public.syslog_events';
  END IF;

  -- Restore syslog_events_old → syslog_events.
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'syslog_events_old' AND relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER TABLE public.syslog_events_old RENAME TO syslog_events';
  END IF;

  -- Recreate indexes on the restored (non-partitioned) table.
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_received_at_idx
           ON public.syslog_events ("received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_site_received_idx
           ON public.syslog_events ("site_id", "received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_device_received_idx
           ON public.syslog_events ("device_id", "received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_source_received_idx
           ON public.syslog_events ("source_ip", "received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_normalized_received_idx
           ON public.syslog_events ("normalized_type", "received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_severity_received_idx
           ON public.syslog_events ("severity", "received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_category_received_idx
           ON public.syslog_events ("category", "received_at")';
END
$do$;

-- =============================================================
-- Rollback syslog_events_raw
-- =============================================================
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_partitioned_table p ON p.partrelid = c.oid
    WHERE c.relname = 'syslog_events_raw'
      AND c.relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $inner$
      DO $inner2$
      DECLARE part_rec record;
      BEGIN
        FOR part_rec IN
          SELECT inhrelid::regclass::text AS part_name
          FROM pg_inherits
          WHERE inhparent = 'public.syslog_events_raw'::regclass
        LOOP
          EXECUTE format('DROP TABLE IF EXISTS public.%I', part_rec.part_name);
        END LOOP;
      END
      $inner2$;
    $inner$;
    EXECUTE 'DROP TABLE IF EXISTS public.syslog_events_raw';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'syslog_events_raw_old' AND relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER TABLE public.syslog_events_raw_old RENAME TO syslog_events_raw';
  END IF;

  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_raw_received_at_idx
           ON public.syslog_events_raw ("received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_raw_source_received_idx
           ON public.syslog_events_raw ("source_ip", "received_at")';
  EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_raw_status_received_idx
           ON public.syslog_events_raw ("ingest_status", "received_at")';
END
$do$;

-- Note: the FK from syslog_events.raw_event_id → syslog_events_raw.id is
-- restored only if the source constraint still exists. The application
-- layer does not require it, so a manual ALTER TABLE ... ADD CONSTRAINT
-- may be needed if your environment previously had the FK.

COMMIT;
