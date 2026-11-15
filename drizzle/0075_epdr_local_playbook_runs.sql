CREATE UNIQUE INDEX epdr_detections_id_site_local_idx ON epdr_detections(id, site_id);
--> statement-breakpoint
CREATE TABLE epdr_local_playbook_runs (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id integer NOT NULL,
  detection_id integer NOT NULL,
  connection_id integer NOT NULL,
  account_revision integer NOT NULL CHECK (account_revision >= 0),
  requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'local' CHECK (mode = 'local'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'finished')),
  evidence jsonb NOT NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CONSTRAINT epdr_local_runs_id_site_idx UNIQUE (id, site_id),
  CONSTRAINT epdr_local_runs_version_detection_idx UNIQUE (site_id, version_id, detection_id),
  CONSTRAINT epdr_local_runs_version_site_fk FOREIGN KEY (version_id, site_id)
    REFERENCES epdr_playbook_versions(id, site_id) ON DELETE CASCADE,
  CONSTRAINT epdr_local_runs_detection_site_fk FOREIGN KEY (detection_id, site_id)
    REFERENCES epdr_detections(id, site_id) ON DELETE CASCADE,
  CONSTRAINT epdr_local_runs_connection_site_fk FOREIGN KEY (connection_id, site_id)
    REFERENCES watchguard_connections(id, site_id) ON DELETE CASCADE,
  CHECK ((status = 'running') = (lease_until IS NOT NULL)),
  CHECK ((status = 'finished') = (finished_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE epdr_local_playbook_steps (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  run_id integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  kind text NOT NULL CHECK (kind IN ('record', 'review', 'incident', 'handoff', 'notify', 'provider')),
  action text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'requires_operator', 'suppressed')),
  reason text,
  finished_at timestamptz,
  CONSTRAINT epdr_local_steps_run_site_fk FOREIGN KEY (run_id, site_id)
    REFERENCES epdr_local_playbook_runs(id, site_id) ON DELETE CASCADE,
  CONSTRAINT epdr_local_steps_order_idx UNIQUE (run_id, ordinal),
  CHECK ((status = 'pending') = (finished_at IS NULL)),
  CHECK ((status = 'pending') = (reason IS NULL)),
  CHECK (kind NOT IN ('notify', 'provider') OR status IN ('pending', 'suppressed')),
  CHECK (kind NOT IN ('incident', 'handoff') OR status IN ('pending', 'requires_operator'))
);
--> statement-breakpoint
CREATE INDEX epdr_local_runs_site_history ON epdr_local_playbook_runs(site_id, id DESC);
--> statement-breakpoint
-- Capture columns and terminal outcomes are append-only even when a lease is reclaimed.
CREATE FUNCTION epdr_local_playbook_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'epdr_local_playbook_runs' THEN
    IF ROW(NEW.site_id, NEW.version_id, NEW.detection_id, NEW.connection_id, NEW.account_revision, NEW.evidence, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.site_id, OLD.version_id, OLD.detection_id, OLD.connection_id, OLD.account_revision, OLD.evidence, OLD.created_at)
       OR (NEW.requested_by IS DISTINCT FROM OLD.requested_by AND NEW.requested_by IS NOT NULL)
       OR (OLD.status = 'finished' AND ROW(NEW.status, NEW.generation, NEW.lease_until, NEW.finished_at)
         IS DISTINCT FROM ROW(OLD.status, OLD.generation, OLD.lease_until, OLD.finished_at)) THEN
      RAISE EXCEPTION 'local playbook evidence is immutable';
    END IF;
  ELSE
    IF ROW(NEW.site_id, NEW.run_id, NEW.ordinal, NEW.kind, NEW.action) IS DISTINCT FROM
       ROW(OLD.site_id, OLD.run_id, OLD.ordinal, OLD.kind, OLD.action)
       OR (OLD.status <> 'pending' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'local playbook outcome is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER epdr_local_runs_immutable BEFORE UPDATE ON epdr_local_playbook_runs
FOR EACH ROW EXECUTE FUNCTION epdr_local_playbook_immutable();
--> statement-breakpoint
CREATE TRIGGER epdr_local_steps_immutable BEFORE UPDATE ON epdr_local_playbook_steps
FOR EACH ROW EXECUTE FUNCTION epdr_local_playbook_immutable();
