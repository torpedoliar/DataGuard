-- Local provenance only. Do not backfill old runs as complete or verified.
CREATE TABLE epdr_detection_read_evidence (
  id serial PRIMARY KEY,
  connection_id integer NOT NULL REFERENCES watchguard_connections(id) ON DELETE CASCADE,
  account_revision integer NOT NULL,
  credential_revision integer NOT NULL,
  settings_updated_at timestamp,
  source text NOT NULL CHECK (source IN ('threatsync', 'event_export')),
  status text NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
  "window" text NOT NULL,
  started_at timestamp NOT NULL,
  finished_at timestamp NOT NULL CHECK (finished_at >= started_at),
  event_types integer[] NOT NULL,
  completed_event_types integer[] NOT NULL
);
--> statement-breakpoint
CREATE INDEX epdr_detection_read_evidence_source_idx ON epdr_detection_read_evidence
  (connection_id, account_revision, credential_revision, source, started_at, id);
