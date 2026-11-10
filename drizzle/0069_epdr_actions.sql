-- Action engine, durable attempts, incident links and provider-sync outbox
-- (T07). All provider writes are blocked by the read-only transport guard; this
-- schema models typed command state for when writes are separately authorized.

CREATE TABLE IF NOT EXISTS "epdr_actions" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "sites"("id"),
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id"),
    "incident_id" integer REFERENCES "incidents"("id") ON DELETE set null,
    "endpoint_id" integer NOT NULL REFERENCES "epdr_endpoints"("id"),
    "evaluation_id" integer REFERENCES "epdr_rule_evaluations"("id"),
    "rule_id" integer REFERENCES "epdr_rules"("id"),
    "action_type" text NOT NULL CHECK ("action_type" IN ('scan','reboot','assign_config','isolate','unisolate','ts_kill_process','ts_quarantine','ts_block_ip','ts_unblock_ip')),
    "params" jsonb NOT NULL,
    "mode" text NOT NULL CHECK ("mode" IN ('approval','automatic','manual')),
    "state" text NOT NULL CHECK ("state" IN ('pending_approval','queued','dispatching','in_progress','completed','failed','cancelled','outcome_unknown','needs_review')),
    "idempotency_key" text NOT NULL UNIQUE,
    "requested_by" integer REFERENCES "users"("id"),
    "approved_by" integer REFERENCES "users"("id"),
    "approved_at" timestamp,
    "approval_expires_at" timestamp,
    "cancelled_by" integer REFERENCES "users"("id"),
    "lease_owner" text,
    "lease_expires_at" timestamp,
    "attempt" integer NOT NULL DEFAULT 0,
    "dispatched_at" timestamp,
    "provider_ref" text,
    "provider_job_id" text,
    "provider_status" integer,
    "provider_status_at" timestamp,
    "affected_items" integer,
    "result" jsonb,
    "error" text,
    "deadline_at" timestamp,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "epdr_actions_state_idx" ON "epdr_actions" ("state", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "epdr_actions_endpoint_idx" ON "epdr_actions" ("endpoint_id", "action_type", "created_at");

CREATE TABLE IF NOT EXISTS "epdr_action_incident_links" (
    "id" serial PRIMARY KEY,
    "action_id" integer NOT NULL REFERENCES "epdr_actions"("id") ON DELETE cascade,
    "incident_id" integer NOT NULL REFERENCES "incidents"("id") ON DELETE cascade,
    "created_at" timestamp DEFAULT now(),
    UNIQUE ("action_id", "incident_id")
);

CREATE TABLE IF NOT EXISTS "epdr_attempts" (
    "id" serial PRIMARY KEY,
    "action_id" integer NOT NULL REFERENCES "epdr_actions"("id") ON DELETE cascade,
    "attempt" integer NOT NULL,
    "started_at" timestamp NOT NULL,
    "status" text NOT NULL,
    "request" jsonb,
    "response" jsonb,
    "error" text,
    UNIQUE ("action_id", "attempt")
);

CREATE TABLE IF NOT EXISTS "epdr_provider_sync_outbox" (
    "id" serial PRIMARY KEY,
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id") ON DELETE cascade,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "kind" text NOT NULL,
    "provider_incident_id" text,
    "dedup_key" text NOT NULL UNIQUE,
    "account_revision" integer NOT NULL DEFAULT 0,
    "evidence_generation" integer NOT NULL DEFAULT 0,
    "payload" jsonb NOT NULL,
    "state" text NOT NULL DEFAULT 'pending',
    "retries" integer NOT NULL DEFAULT 0,
    "error" text,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);