-- Durable LOCAL approvals for provider-action intentions plus opt-in overdue
-- escalation to site admins. Decisions are local records only: no dispatcher or
-- transport observes the approval table, and the read-only lock is unchanged.

CREATE UNIQUE INDEX IF NOT EXISTS epdr_endpoints_id_site_idx ON epdr_endpoints(id, site_id);
--> statement-breakpoint
CREATE TABLE epdr_local_approvals (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  detection_id integer NOT NULL,
  local_run_id integer NOT NULL,
  endpoint_id integer NOT NULL,
  connection_id integer NOT NULL,
  account_revision integer NOT NULL,
  action_intent text NOT NULL CHECK (action_intent IN ('scan', 'isolate')),
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by integer NOT NULL REFERENCES users(id),
  decided_by integer REFERENCES users(id),
  decided_at timestamp,
  decision jsonb,
  decision_note text,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (site_id, local_run_id, action_intent),
  FOREIGN KEY (local_run_id, site_id) REFERENCES epdr_local_playbook_runs(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (detection_id, site_id) REFERENCES epdr_detections(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (endpoint_id, site_id) REFERENCES epdr_endpoints(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id, site_id) REFERENCES watchguard_connections(id, site_id) ON DELETE CASCADE,
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decided_by <> requested_by))
);
--> statement-breakpoint
CREATE INDEX epdr_local_approvals_site_status_idx ON epdr_local_approvals(site_id, status, expires_at, id);
--> statement-breakpoint
ALTER TABLE epdr_local_notification_policies
  ADD COLUMN escalate_overdue_to_admins boolean NOT NULL DEFAULT false;
