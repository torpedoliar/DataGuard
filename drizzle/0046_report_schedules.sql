CREATE TABLE IF NOT EXISTS "report_schedules" (
    "id" serial PRIMARY KEY,
    "site_id" integer REFERENCES "sites"("id") ON DELETE CASCADE,
    "name" varchar(255) NOT NULL,
    "report_type" varchar(50) NOT NULL DEFAULT 'audit_grid',
    "frequency" varchar(20) NOT NULL DEFAULT 'weekly',
    "day_of_week" integer DEFAULT 1,
    "day_of_month" integer DEFAULT 1,
    "run_time" varchar(10) NOT NULL DEFAULT '08:00',
    "recipients" text NOT NULL,
    "email_subject" text,
    "include_pdf" boolean NOT NULL DEFAULT true,
    "include_summary_html" boolean NOT NULL DEFAULT true,
    "is_active" boolean NOT NULL DEFAULT true,
    "last_run_at" timestamp with time zone,
    "next_run_at" timestamp with time zone,
    "last_run_status" varchar(50),
    "last_run_error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "report_schedules_next_run_idx" ON "report_schedules" ("next_run_at") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "report_schedules_site_id_idx" ON "report_schedules" ("site_id");
