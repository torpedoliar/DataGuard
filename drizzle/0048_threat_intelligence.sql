DO $$ BEGIN
    CREATE TYPE "threat_intelligence_status" AS ENUM('open', 'in_progress', 'mitigated', 'not_applicable', 'accepted_risk');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "threat_intelligence_severity" AS ENUM('critical', 'high', 'medium', 'low');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "threat_intelligences" (
    "id" serial PRIMARY KEY,
    "site_id" integer REFERENCES "sites"("id") ON DELETE SET NULL,
    "device_id" integer REFERENCES "devices"("id") ON DELETE SET NULL,
    "intel_date" timestamp with time zone NOT NULL,
    "source" text NOT NULL,
    "source_url" text,
    "title" text NOT NULL,
    "cve_list" text,
    "cvss_score" real,
    "severity" "threat_intelligence_severity" NOT NULL DEFAULT 'medium',
    "description" text,
    "affected_asset" text NOT NULL,
    "status" "threat_intelligence_status" NOT NULL DEFAULT 'open',
    "mitigated_at" timestamp with time zone,
    "mitigation_action" text,
    "created_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "threat_intel_site_id_idx" ON "threat_intelligences" ("site_id");
CREATE INDEX IF NOT EXISTS "threat_intel_status_idx" ON "threat_intelligences" ("status");
CREATE INDEX IF NOT EXISTS "threat_intel_intel_date_idx" ON "threat_intelligences" ("intel_date");

CREATE TABLE IF NOT EXISTS "threat_intelligence_evidences" (
    "id" serial PRIMARY KEY,
    "threat_intel_id" integer NOT NULL REFERENCES "threat_intelligences"("id") ON DELETE CASCADE,
    "file_path" text NOT NULL,
    "file_name" text,
    "file_size" integer,
    "mime_type" text,
    "caption" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "threat_intel_evidence_intel_id_idx" ON "threat_intelligence_evidences" ("threat_intel_id");
