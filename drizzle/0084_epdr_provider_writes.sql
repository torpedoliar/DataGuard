-- Provider write execution ledger.
--
-- Additive and default-off. No site can dispatch a provider write until BOTH
-- `watchguard_global_settings.provider_writes_enabled` and
-- `epdr_site_settings.provider_writes_enabled` are turned on explicitly, the
-- action is present in both allowlists, and a second administrator has approved
-- the exact frozen snapshot. Nothing in this migration enables a write.
--
-- Existing rows keep working: every new column is nullable or has a default,
-- and the new CHECK constraints are added NOT VALID so a pre-existing row can
-- never make the migration fail. They still apply to every new write.

ALTER TABLE watchguard_global_settings
  ADD COLUMN IF NOT EXISTS provider_writes_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE watchguard_global_settings
  ADD COLUMN IF NOT EXISTS approval_expiry_minutes integer NOT NULL DEFAULT 60;
--> statement-breakpoint
ALTER TABLE epdr_site_settings
  ADD COLUMN IF NOT EXISTS provider_writes_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Per-site narrowing of the global action ceiling. Empty means "no writes",
-- never "all writes".
ALTER TABLE epdr_site_settings
  ADD COLUMN IF NOT EXISTS allowed_actions text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
ALTER TABLE epdr_actions
  ADD COLUMN IF NOT EXISTS namespace text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS provider_incident_id text,
  ADD COLUMN IF NOT EXISTS snapshot jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_hash text,
  ADD COLUMN IF NOT EXISTS approved_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS account_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credential_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outcome_unknown_reason text,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS observe_after timestamp,
  ADD COLUMN IF NOT EXISTS observed_at timestamp,
  ADD COLUMN IF NOT EXISTS observe_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_kind text,
  ADD COLUMN IF NOT EXISTS body_hash text;
--> statement-breakpoint
-- The old key blocked every repeat of the same action on the same endpoint.
-- A repeat is legitimate once the previous request reached a terminal state, so
-- uniqueness is now scoped to *active* requests only.
ALTER TABLE epdr_actions DROP CONSTRAINT IF EXISTS epdr_actions_idempotency_key_key;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS epdr_actions_idempotency_idx ON epdr_actions (idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS epdr_actions_active_intent_unique
  ON epdr_actions (site_id, idempotency_key)
  WHERE state IN ('pending_approval', 'queued', 'dispatching', 'in_progress', 'outcome_unknown', 'needs_review');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS epdr_actions_observe_idx
  ON epdr_actions (state, observe_after)
  WHERE state IN ('in_progress', 'outcome_unknown');
--> statement-breakpoint
ALTER TABLE epdr_actions
  ADD CONSTRAINT epdr_actions_namespace_check
  CHECK (namespace IS NULL OR namespace IN ('endpoint_security', 'threatsync')) NOT VALID;
--> statement-breakpoint
-- An approval always describes the exact frozen snapshot that will be sent.
ALTER TABLE epdr_actions
  ADD CONSTRAINT epdr_actions_approved_snapshot_check
  CHECK (approved_by IS NULL OR (approved_snapshot_hash IS NOT NULL AND approved_snapshot_hash = snapshot_hash)) NOT VALID;
--> statement-breakpoint
-- A request can never be approved by the administrator who requested it.
ALTER TABLE epdr_actions
  ADD CONSTRAINT epdr_actions_no_self_approval_check
  CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by) NOT VALID;
--> statement-breakpoint
ALTER TABLE epdr_attempts
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'dispatch',
  ADD COLUMN IF NOT EXISTS response_status integer,
  ADD COLUMN IF NOT EXISTS snapshot_hash text;
--> statement-breakpoint
ALTER TABLE epdr_attempts
  ADD CONSTRAINT epdr_attempts_phase_check
  CHECK (phase IN ('dispatch', 'observe')) NOT VALID;
