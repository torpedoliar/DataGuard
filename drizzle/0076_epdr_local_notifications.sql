-- Local-only, opt-in EPDR notification policy. No external transport configuration.
CREATE TABLE epdr_local_notification_policies (
  site_id integer PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  notify_held boolean NOT NULL DEFAULT false,
  updated_by integer NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE epdr_local_notification_outbox (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  recipient_id integer NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('assigned', 'overdue')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'delivered', 'cancelled', 'failed')),
  available_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  lease_token text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE (incident_id, recipient_id, kind)
);
CREATE INDEX epdr_local_notification_claim_idx ON epdr_local_notification_outbox (status, available_at, lease_until);
--> statement-breakpoint
CREATE TABLE epdr_local_notifications (
  id serial PRIMARY KEY,
  outbox_id integer NOT NULL UNIQUE REFERENCES epdr_local_notification_outbox(id) ON DELETE CASCADE,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  recipient_id integer NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('assigned', 'overdue')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz
);
CREATE INDEX epdr_local_notifications_inbox_idx ON epdr_local_notifications (site_id, recipient_id, id DESC);
--> statement-breakpoint
CREATE TABLE epdr_local_notification_audit (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  actor_id integer REFERENCES users(id),
  event text NOT NULL CHECK (event IN ('policy_changed', 'delivered', 'cancelled', 'read', 'retry', 'failed')),
  incident_id integer REFERENCES incidents(id) ON DELETE CASCADE,
  outbox_id integer REFERENCES epdr_local_notification_outbox(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
