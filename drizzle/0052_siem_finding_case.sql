-- SIEM finding case workflow (P1): assignee + threaded comments on findings.
-- Assignee is per finding (one active owner); comments are append-only audit
-- of the investigation. Status lifecycle stays Open/Acknowledged/Resolved.

ALTER TABLE "siem_findings" ADD COLUMN IF NOT EXISTS "assigned_to_id" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "siem_finding_comments" (
    "id" serial PRIMARY KEY,
    "finding_id" integer NOT NULL REFERENCES "siem_findings"("id") ON DELETE CASCADE,
    "author_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
    "body" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "siem_finding_comments_finding_idx" ON "siem_finding_comments" ("finding_id", "created_at");
