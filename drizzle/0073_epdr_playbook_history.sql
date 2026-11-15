CREATE TABLE epdr_playbook_versions (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  template_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  mode text NOT NULL DEFAULT 'simulate' CHECK (mode = 'simulate'),
  configuration jsonb NOT NULL,
  definition jsonb NOT NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT epdr_playbook_template_version_idx UNIQUE (site_id, template_id, version),
  CONSTRAINT epdr_playbook_versions_id_site_idx UNIQUE (id, site_id)
);
--> statement-breakpoint
CREATE TABLE epdr_playbook_runs (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id integer NOT NULL,
  requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status = 'simulation_recorded'),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT epdr_playbook_run_version_site_fk FOREIGN KEY (version_id, site_id)
    REFERENCES epdr_playbook_versions(id, site_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX epdr_playbook_runs_site_history ON epdr_playbook_runs(site_id, id DESC);
