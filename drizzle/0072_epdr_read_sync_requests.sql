CREATE UNIQUE INDEX watchguard_connections_id_site_idx ON watchguard_connections(id, site_id);
--> statement-breakpoint
CREATE TABLE epdr_read_sync_requests (
  id serial PRIMARY KEY,
  connection_id integer NOT NULL,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  account_revision integer NOT NULL,
  requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  CONSTRAINT epdr_read_sync_connection_site_fk FOREIGN KEY (connection_id, site_id)
    REFERENCES watchguard_connections(id, site_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX epdr_read_sync_one_pending ON epdr_read_sync_requests(connection_id) WHERE status IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX epdr_read_sync_site_history ON epdr_read_sync_requests(site_id, id DESC);
