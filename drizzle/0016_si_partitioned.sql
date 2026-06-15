-- 0016_si_partitioned.sql
-- Convert syslog_events_raw and syslog_events to RANGE-partitioned tables
-- (PARTITION BY RANGE (received_at)), with weekly partitions covering
-- existing data + 2 weeks ahead.
--
-- This migration is idempotent:
--   * If a table is already partitioned, the DO block skips it.
--   * CREATE TABLE IF NOT EXISTS is used for the partitioned twin and
--     weekly partitions, so a partial run can be re-applied safely.
--   * The old table is renamed to <base>_old only if it still exists under
--     the original name; the partitioned twin takes the original name.
--
-- The reverse (rollback) is in 0016_si_partitioned.down.sql.
--
-- Audit reference: finding N26 — convert scripts/siem-partition-migrate.ts
-- to a drizzle migration file (idempotent) + add a rollback script.

BEGIN;

-- Helper: returns true if a table with the given name is already partitioned
-- (i.e. has a row in pg_partitioned_table).
CREATE OR REPLACE FUNCTION pg_temp.is_partitioned(tbl_name text)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_partitioned_table p ON p.partrelid = c.oid
    WHERE c.relname = tbl_name
      AND c.relkind = 'r'
      AND c.relnamespace = 'public'::regnamespace
  );
$$;

-- Helper: returns the (min, max) received_at range of a table. NULLs if
-- the table does not exist or is empty.
CREATE OR REPLACE FUNCTION pg_temp.table_received_range(tbl_name text)
RETURNS TABLE(min_received timestamp, max_received timestamp)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT MIN(received_at)::timestamp, MAX(received_at)::timestamp FROM public.%I',
    tbl_name
  );
END;
$$;

-- =============================================================
-- 1) syslog_events_raw
-- =============================================================
DO $do$
DECLARE
  twin_name text := 'syslog_events_raw_partitioned';
  old_name  text := 'syslog_events_raw_old';
  r record;
  range_min timestamp;
  range_max timestamp;
  cur_week_start timestamp;
  week_end timestamp;
  i int;
  back int;
  ahead int;
  part_name text;
  has_fk boolean;
BEGIN
  IF pg_temp.is_partitioned('syslog_events_raw') THEN
    RAISE NOTICE 'syslog_events_raw already partitioned — skipping';
  ELSE
    -- Create the partitioned twin (no data yet).
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I (
        "id" serial NOT NULL,
        "received_at" timestamp NOT NULL DEFAULT now(),
        "source_ip" text NOT NULL,
        "source_port" integer NOT NULL,
        "transport" "syslog_transport" NOT NULL DEFAULT ''udp'',
        "raw_message" text NOT NULL,
        "raw_size" integer NOT NULL,
        "ingest_status" "syslog_ingest_status" NOT NULL DEFAULT ''received'',
        "parse_error" text,
        "created_at" timestamp DEFAULT now(),
        PRIMARY KEY ("id", "received_at")
      ) PARTITION BY RANGE ("received_at")',
      twin_name
    );

    -- Drop the FK from syslog_events.raw_event_id → syslog_events_raw.id
    -- while the original is still around. Partitioned tables cannot be
    -- referenced by a regular FK constraint.
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'syslog_events'
        AND c.conname = 'syslog_events_raw_event_id_syslog_events_raw_id_fk'
    ) INTO has_fk;
    IF has_fk THEN
      EXECUTE 'ALTER TABLE public.syslog_events
               DROP CONSTRAINT syslog_events_raw_event_id_syslog_events_raw_id_fk';
    END IF;

    -- Decide which weeks to create: cover any existing data + 2 ahead.
    SELECT * INTO r FROM pg_temp.table_received_range('syslog_events_raw');
    range_min := r.min_received;
    range_max := r.max_received;

    IF range_min IS NULL THEN
      range_min := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      range_max := range_min;
    END IF;

    back  := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (range_max - range_min)) / (7*24*3600))::int);
    ahead := 2;
    cur_week_start := date_trunc('week', range_min AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

    FOR i IN -back..ahead LOOP
      week_end := cur_week_start + (i + 1) * interval '7 days';
      part_name := format('syslog_events_raw_p%s',
        to_char(cur_week_start + i * interval '7 days', 'YYYYMMDD'));
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I
         FOR VALUES FROM (%L) TO (%L)',
        part_name, twin_name,
        to_char(cur_week_start + i * interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        to_char(week_end, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      );
    END LOOP;

    -- Copy data.
    EXECUTE format('INSERT INTO public.%I SELECT * FROM public.syslog_events_raw', twin_name);

    -- Reset the id sequence so new inserts do not collide.
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, ''id''),
                     COALESCE((SELECT MAX(id) FROM public.%I), 1))',
      twin_name, twin_name
    );

    -- Rename old → _old, new → original.
    IF EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'syslog_events_raw' AND relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format('ALTER TABLE public.syslog_events_raw RENAME TO %I', old_name);
    END IF;
    EXECUTE format('ALTER TABLE public.%I RENAME TO syslog_events_raw', twin_name);

    -- Recreate indexes on the new parent (propagates to partitions).
    EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_raw_received_at_idx
             ON public.syslog_events_raw ("received_at")';
    EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_raw_source_received_idx
             ON public.syslog_events_raw ("source_ip", "received_at")';
    EXECUTE 'CREATE INDEX IF NOT EXISTS syslog_events_raw_status_received_idx
             ON public.syslog_events_raw ("ingest_status", "received_at")';

    RAISE NOTICE 'syslog_events_raw converted to partitioned table (old data in syslog_events_raw_old)';
  END IF;
END
$do$;

-- =============================================================
-- 2) syslog_events
-- =============================================================
DO $do$
DECLARE
  twin_name text := 'syslog_events_partitioned';
  old_name  text := 'syslog_events_old';
  r record;
  range_min timestamp;
  range_max timestamp;
  cur_week_start timestamp;
  week_end timestamp;
  i int;
  back int;
  ahead int;
  part_name text;
BEGIN
  IF pg_temp.is_partitioned('syslog_events') THEN
    RAISE NOTICE 'syslog_events already partitioned — skipping';
  ELSE
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I (
        "id" serial NOT NULL,
        "raw_event_id" integer NOT NULL,
        "event_time" timestamp,
        "received_at" timestamp NOT NULL,
        "source_ip" text NOT NULL,
        "hostname" text,
        "facility" integer,
        "severity" integer,
        "priority" integer,
        "app_name" text,
        "program" text,
        "process_id" text,
        "message" text NOT NULL,
        "site_id" integer,
        "device_id" integer,
        "source_id" integer,
        "vendor" "syslog_vendor",
        "parser" text NOT NULL,
        "category" text,
        "normalized_type" text,
        "action" text,
        "outcome" text,
        "src_ip" text,
        "src_port" integer,
        "dst_ip" text,
        "dst_port" integer,
        "username" text,
        "interface_name" text,
        "protocol" text,
        "tags" jsonb NOT NULL DEFAULT ''[]''::jsonb,
        "metadata" jsonb NOT NULL DEFAULT ''{}''::jsonb,
        "created_at" timestamp DEFAULT now(),
        PRIMARY KEY ("id", "received_at")
      ) PARTITION BY RANGE ("received_at")',
      twin_name
    );

    SELECT * INTO r FROM pg_temp.table_received_range('syslog_events');
    range_min := r.min_received;
    range_max := r.max_received;

    IF range_min IS NULL THEN
      range_min := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      range_max := range_min;
    END IF;

    back  := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (range_max - range_min)) / (7*24*3600))::int);
    ahead := 2;
    cur_week_start := date_trunc('week', range_min AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

    FOR i IN -back..ahead LOOP
      week_end := cur_week_start + (i + 1) * interval '7 days';
      part_name := format('syslog_events_p%s',
        to_char(cur_week_start + i * interval '7 days', 'YYYYMMDD'));
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I
         FOR VALUES FROM (%L) TO (%L)',
        part_name, twin_name,
        to_char(cur_week_start + i * interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        to_char(week_end, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      );
    END LOOP;

    EXECUTE format('INSERT INTO public.%I SELECT * FROM public.syslog_events', twin_name);

    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, ''id''),
                     COALESCE((SELECT MAX(id) FROM public.%I), 1))',
      twin_name, twin_name
    );

    IF EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'syslog_events' AND relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format('ALTER TABLE public.syslog_events RENAME TO %I', old_name);
    END IF;
    EXECUTE format('ALTER TABLE public.%I RENAME TO syslog_events', twin_name);

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

    RAISE NOTICE 'syslog_events converted to partitioned table (old data in syslog_events_old)';
  END IF;
END
$do$;

-- Note: the FK from syslog_events.raw_event_id → syslog_events_raw.id is
-- intentionally not recreated here. The application layer maintains that
-- reference (see lib/siem/evidence.ts) because cross-partition FKs are not
-- natively supported. Recreate manually if your data model requires it.

COMMIT;
