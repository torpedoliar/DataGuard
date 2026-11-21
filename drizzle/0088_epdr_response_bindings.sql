-- Operational recommendations are separate from immutable simulation versions.
CREATE TABLE epdr_response_bindings (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id integer NOT NULL,
  connection_id integer NOT NULL,
  account_revision integer NOT NULL CHECK (account_revision >= 0),
  response text NOT NULL CHECK (response IN ('scan', 'isolate')),
  mode text NOT NULL DEFAULT 'recommendation_only' CHECK (mode = 'recommendation_only'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused')),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evaluation_after timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (id, site_id),
  FOREIGN KEY (version_id, site_id) REFERENCES epdr_playbook_versions(id, site_id),
  FOREIGN KEY (connection_id, site_id) REFERENCES watchguard_connections(id, site_id)
);
CREATE INDEX epdr_response_bindings_active ON epdr_response_bindings(connection_id, id) WHERE state = 'active';
CREATE TABLE epdr_response_recommendations (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  binding_id integer NOT NULL,
  detection_id integer NOT NULL REFERENCES epdr_detections(id),
  read_evidence_id integer NOT NULL REFERENCES epdr_detection_read_evidence(id),
  endpoint_id integer REFERENCES epdr_endpoints(id),
  response text NOT NULL CHECK (response IN ('scan', 'isolate')),
  status text NOT NULL CHECK (status IN ('matched', 'blocked')),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT epdr_response_recommendations_binding_detection_read_key UNIQUE (binding_id, detection_id, read_evidence_id),
  UNIQUE (id, site_id),
  FOREIGN KEY (binding_id, site_id) REFERENCES epdr_response_bindings(id, site_id),
  FOREIGN KEY (detection_id, site_id) REFERENCES epdr_detections(id, site_id),
  FOREIGN KEY (endpoint_id, site_id) REFERENCES epdr_endpoints(id, site_id)
);
CREATE INDEX epdr_response_recommendations_history ON epdr_response_recommendations(site_id, id DESC);
CREATE INDEX epdr_response_recommendations_fair_queue ON epdr_response_recommendations(binding_id, detection_id, created_at DESC);
-- Execution creation owns this insert in the same transaction as pending_approval.
CREATE TABLE epdr_response_request_links (
  recommendation_id integer PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  request_id integer NOT NULL UNIQUE REFERENCES epdr_actions(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (recommendation_id, site_id) REFERENCES epdr_response_recommendations(id, site_id)
);
CREATE FUNCTION epdr_response_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'epdr_response_bindings' THEN
    IF NEW.evaluation_after < OLD.evaluation_after OR
       (to_jsonb(NEW) - 'state' - 'created_by' - 'evaluation_after') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'created_by' - 'evaluation_after') THEN
      RAISE EXCEPTION 'immutable response binding';
    END IF;
  ELSE
    RAISE EXCEPTION 'immutable response evidence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER epdr_response_binding_immutable BEFORE UPDATE ON epdr_response_bindings FOR EACH ROW EXECUTE FUNCTION epdr_response_immutable();
CREATE TRIGGER epdr_response_recommendation_immutable BEFORE UPDATE ON epdr_response_recommendations FOR EACH ROW EXECUTE FUNCTION epdr_response_immutable();
CREATE TRIGGER epdr_response_link_immutable BEFORE UPDATE ON epdr_response_request_links FOR EACH ROW EXECUTE FUNCTION epdr_response_immutable();
