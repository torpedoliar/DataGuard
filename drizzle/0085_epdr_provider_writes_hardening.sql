-- EPDR provider write hardening: atomic limits, cooldown/indexing, append-only
-- attempt events, worker heartbeats, observation/confirmation, and retention.
--
-- Additive and default-safe. Existing rows remain valid.

--> statement-breakpoint
ALTER TABLE epdr_actions
  ADD COLUMN IF NOT EXISTS action_context jsonb NOT NULL DEFAULT '{}'::jsonb;

--> statement-breakpoint
ALTER TABLE epdr_provider_incidents
  ADD COLUMN IF NOT EXISTS confirmed_by integer,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_sync_error text;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_provider_incidents
    ADD CONSTRAINT epdr_provider_incidents_confirmed_by_fk
      FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
ALTER TABLE epdr_provider_incident_targets
  ADD COLUMN IF NOT EXISTS confirmed_by integer,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_sync_error text;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_provider_incident_targets
    ADD CONSTRAINT epdr_provider_incident_targets_confirmed_by_fk
      FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
ALTER TABLE epdr_attempts
  ADD COLUMN IF NOT EXISTS connection_id integer,
  ADD COLUMN IF NOT EXISTS endpoint_id integer,
  ADD COLUMN IF NOT EXISTS action_type text;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_attempts
    ADD CONSTRAINT epdr_attempts_connection_fk
      FOREIGN KEY (connection_id) REFERENCES watchguard_connections(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_attempts
    ADD CONSTRAINT epdr_attempts_endpoint_fk
      FOREIGN KEY (endpoint_id) REFERENCES epdr_endpoints(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
-- Backfill audit/reservation columns from the owning action.
UPDATE epdr_attempts a
SET connection_id = act.connection_id,
    endpoint_id = act.endpoint_id,
    action_type = act.action_type
FROM epdr_actions act
WHERE a.action_id = act.id
  AND (a.connection_id IS NULL OR a.endpoint_id IS NULL OR a.action_type IS NULL);

--> statement-breakpoint
-- Cooldown/rate-limit lookups: recent dispatches per connection+endpoint+action.
CREATE INDEX IF NOT EXISTS epdr_actions_cooldown_idx
  ON epdr_actions (connection_id, endpoint_id, action_type, dispatched_at DESC)
  WHERE dispatched_at IS NOT NULL;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS epdr_attempts_audit_idx
  ON epdr_attempts (connection_id, endpoint_id, action_type, started_at DESC);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS epdr_attempt_events (
  id serial PRIMARY KEY,
  action_id integer NOT NULL REFERENCES epdr_actions(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  phase text NOT NULL,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS epdr_attempt_events_action_attempt_idx
  ON epdr_attempt_events (action_id, attempt, created_at);

--> statement-breakpoint
-- The attempt ledger is append-only at the database level: corrections appear
-- as new events, never updates or deletes.
CREATE OR REPLACE FUNCTION epdr_attempt_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'epdr_attempt_events is append-only';
END $$ LANGUAGE plpgsql;

--> statement-breakpoint
DO $$ BEGIN
  CREATE TRIGGER epdr_attempt_events_no_update
    BEFORE UPDATE OR DELETE ON epdr_attempt_events
    FOR EACH ROW EXECUTE FUNCTION epdr_attempt_events_append_only();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
-- One row per worker process; the worker heartbeat is the health signal for
-- "is anyone actually dispatching/observing", not a per-job status log.
CREATE TABLE IF NOT EXISTS epdr_worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_pass_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_pass_ran boolean NOT NULL DEFAULT false,
  last_pass_failed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

--> statement-breakpoint
ALTER TABLE epdr_site_settings
  ADD COLUMN IF NOT EXISTS execution_attempt_retention_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS execution_result_retention_days integer NOT NULL DEFAULT 180;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_site_settings
    ADD CONSTRAINT epdr_site_settings_execution_attempt_retention_check
      CHECK (execution_attempt_retention_days >= 7 AND execution_attempt_retention_days <= 3650);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_site_settings
    ADD CONSTRAINT epdr_site_settings_execution_result_retention_check
      CHECK (execution_result_retention_days >= 7 AND execution_result_retention_days <= 3650);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
-- Per-site execution limits. max_actions_per_hour NULL = follow the global cap.
ALTER TABLE epdr_site_settings
  ADD COLUMN IF NOT EXISTS execution_cooldown_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_actions_per_hour integer;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_site_settings
    ADD CONSTRAINT epdr_site_settings_execution_cooldown_check
      CHECK (execution_cooldown_minutes >= 0 AND execution_cooldown_minutes <= 1440);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE epdr_site_settings
    ADD CONSTRAINT epdr_site_settings_max_actions_per_hour_check
      CHECK (max_actions_per_hour IS NULL OR (max_actions_per_hour >= 1 AND max_actions_per_hour <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
-- Hourly dispatch-attempt counting and observation scheduling read attempts by
-- phase + time; retention deletes by started_at.
CREATE INDEX IF NOT EXISTS epdr_attempts_phase_started_idx
  ON epdr_attempts (phase, started_at);

--> statement-breakpoint
-- Queue claim scan: one index that serves the dispatcher's candidate filter.
CREATE INDEX IF NOT EXISTS epdr_actions_queue_idx
  ON epdr_actions (site_id, id)
  WHERE state = 'queued' AND mode = 'approval' AND namespace IS NOT NULL;

--> statement-breakpoint
-- Site-scoped cooldown lookup (the connection-scoped twin above serves the
-- claim anti-join; this one serves request/approve-time checks).
CREATE INDEX IF NOT EXISTS epdr_actions_site_cooldown_idx
  ON epdr_actions (site_id, endpoint_id, action_type, dispatched_at DESC)
  WHERE dispatched_at IS NOT NULL;

--> statement-breakpoint
-- Provider incident ingestion keys off the binding revision: a re-bound
-- account is a different incident population, not an update of the old one.
ALTER TABLE epdr_provider_incidents
  ADD COLUMN IF NOT EXISTS account_revision integer NOT NULL DEFAULT 0;

--> statement-breakpoint
DROP INDEX IF EXISTS epdr_provider_incidents_connection_ts_idx;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS epdr_provider_incidents_connection_revision_ts_idx
  ON epdr_provider_incidents (connection_id, account_revision, ts_incident_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS epdr_provider_incident_targets_endpoint_idx
  ON epdr_provider_incident_targets (endpoint_id);

--> statement-breakpoint
ALTER TABLE watchguard_connections
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_sync_error text;
