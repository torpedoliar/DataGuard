-- SIEM lightweight SOAR (P2): approved response actions. An operator defines a
-- webhook action (e.g. firewall block API); execution REQUIRES manual approval
-- by another admin action before the worker POSTs it. Everything is
-- audit-logged at creation, approval, and execution time.

CREATE TABLE IF NOT EXISTS "siem_response_actions" (
    "id" serial PRIMARY KEY,
    "finding_id" integer NOT NULL REFERENCES "siem_findings"("id") ON DELETE CASCADE,
    "requested_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
    "approved_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
    "approved_at" timestamp with time zone,
    "action_type" text NOT NULL,
    "webhook_url" text NOT NULL,
    "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "status" text NOT NULL DEFAULT 'pending_approval',
    "executed_at" timestamp with time zone,
    "response_status" integer,
    "response_body" text,
    "error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "siem_response_actions_finding_idx" ON "siem_response_actions" ("finding_id");
CREATE INDEX IF NOT EXISTS "siem_response_actions_status_idx" ON "siem_response_actions" ("status");
