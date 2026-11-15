-- Opt-in daily local digest plus a nullable incident target for digest rows.
-- Additive: existing policies stay disabled, existing notification rows keep
-- their incident target. No external channel is introduced.

-- Extend the kind vocabulary: escalation was introduced in 0082 and the digest
-- here; the original 0076 checks only allowed assigned/overdue.
ALTER TABLE epdr_local_notification_outbox DROP CONSTRAINT IF EXISTS epdr_local_notification_outbox_kind_check;
--> statement-breakpoint
ALTER TABLE epdr_local_notification_outbox
  ADD CONSTRAINT epdr_local_notification_outbox_kind_check
  CHECK (kind IN ('assigned', 'overdue', 'sla_escalation', 'digest'));
--> statement-breakpoint
ALTER TABLE epdr_local_notifications DROP CONSTRAINT IF EXISTS epdr_local_notifications_kind_check;
--> statement-breakpoint
ALTER TABLE epdr_local_notifications
  ADD CONSTRAINT epdr_local_notifications_kind_check
  CHECK (kind IN ('assigned', 'overdue', 'sla_escalation', 'digest'));
--> statement-breakpoint
ALTER TABLE epdr_local_notification_policies
  ADD COLUMN digest_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN digest_hour_utc integer,
  ADD CONSTRAINT epdr_local_digest_pair_check CHECK (
    (digest_enabled = false AND digest_hour_utc IS NULL) OR
    (digest_enabled = true AND digest_hour_utc IS NOT NULL AND digest_hour_utc BETWEEN 0 AND 23)
  );
--> statement-breakpoint
ALTER TABLE epdr_local_notification_outbox ALTER COLUMN incident_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE epdr_local_notification_outbox ADD COLUMN digest_day date;
--> statement-breakpoint
ALTER TABLE epdr_local_notification_outbox
  ADD CONSTRAINT epdr_local_outbox_digest_target_check CHECK (
    (kind = 'digest' AND incident_id IS NULL AND digest_day IS NOT NULL) OR
    (kind <> 'digest' AND incident_id IS NOT NULL AND digest_day IS NULL)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX epdr_local_outbox_digest_day_unique
  ON epdr_local_notification_outbox(recipient_id, digest_day) WHERE kind = 'digest';
--> statement-breakpoint
ALTER TABLE epdr_local_notifications ALTER COLUMN incident_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE epdr_local_notifications
  ADD CONSTRAINT epdr_local_notification_target_check CHECK (incident_id IS NOT NULL OR kind = 'digest');
