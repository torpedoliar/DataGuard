CREATE TABLE epdr_incident_handoffs (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  detection_id integer NOT NULL UNIQUE REFERENCES epdr_detections(id) ON DELETE CASCADE,
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  connection_id integer NOT NULL,
  account_revision integer NOT NULL,
  requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  assignee_id integer REFERENCES users(id) ON DELETE SET NULL,
  pic_group_id integer REFERENCES device_groups(id) ON DELETE SET NULL,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT epdr_handoff_connection_site_fk FOREIGN KEY (connection_id, site_id)
    REFERENCES watchguard_connections(id, site_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX epdr_incident_handoffs_site_history ON epdr_incident_handoffs(site_id, id DESC);
