-- SIEM multi-site: expand phase. Add nullable site_id columns to the SIEM tables
-- that lack tenancy, and backfill every existing NULL row from its source/device.
-- No NOT NULL, no new unique constraints yet (contract phase in 0024 part 2 / 1b).
-- Fallback site = min(id) of active sites, never a hardcoded id. If no sites exist
-- (fresh deploy), the backfill is a no-op and columns stay nullable.

ALTER TABLE "syslog_events_raw" ADD COLUMN IF NOT EXISTS "site_id" integer;--> statement-breakpoint
ALTER TABLE "siem_rules" ADD COLUMN IF NOT EXISTS "site_id" integer;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD COLUMN IF NOT EXISTS "site_id" integer;--> statement-breakpoint
ALTER TABLE "siem_events_quarantine" ADD COLUMN IF NOT EXISTS "site_id" integer;--> statement-breakpoint
ALTER TABLE "siem_dashboard_snapshots" ADD COLUMN IF NOT EXISTS "site_id" integer;--> statement-breakpoint

-- FK constraints: PostgreSQL ADD CONSTRAINT lacks IF NOT EXISTS, so guard with a DO block.
-- Idempotent so re-running (e.g. operator already applied via psql) does not fail.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syslog_events_raw_site_id_sites_id_fk') THEN
    ALTER TABLE "syslog_events_raw" ADD CONSTRAINT "syslog_events_raw_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'siem_rules_site_id_sites_id_fk') THEN
    ALTER TABLE "siem_rules" ADD CONSTRAINT "siem_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'siem_settings_site_id_sites_id_fk') THEN
    ALTER TABLE "siem_settings" ADD CONSTRAINT "siem_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'siem_events_quarantine_site_id_sites_id_fk') THEN
    ALTER TABLE "siem_events_quarantine" ADD CONSTRAINT "siem_events_quarantine_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'siem_dashboard_snapshots_site_id_sites_id_fk') THEN
    ALTER TABLE "siem_dashboard_snapshots" ADD CONSTRAINT "siem_dashboard_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "syslog_events_raw_site_received_idx" ON "syslog_events_raw" USING btree ("site_id","received_at");--> statement-breakpoint

-- Backfill. All statements idempotent (WHERE ... IS NULL). Fallback subquery repeats;
-- Postgres evaluates it per row but sites is tiny.

UPDATE "syslog_sources" SET "site_id" = (SELECT min(id) FROM "sites" WHERE "is_active" = true) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "syslog_events" SET "site_id" = COALESCE("site_id", (SELECT s.site_id FROM "syslog_sources" s WHERE s.id = "syslog_events"."source_id"), (SELECT min(id) FROM "sites" WHERE "is_active" = true)) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "syslog_events_raw" SET "site_id" = (SELECT s.site_id FROM "syslog_sources" s WHERE s.source_ip = "syslog_events_raw"."source_ip" LIMIT 1) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "syslog_events_raw" SET "site_id" = (SELECT min(id) FROM "sites" WHERE "is_active" = true) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "siem_findings" SET "site_id" = COALESCE("site_id", (SELECT e.site_id FROM "syslog_events" e WHERE e.id = ("siem_findings"."sample_event_ids"->0)::int), (SELECT s.site_id FROM "syslog_sources" s WHERE s.id = "siem_findings"."source_id"), (SELECT min(id) FROM "sites" WHERE "is_active" = true)) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "siem_events_quarantine" SET "site_id" = (SELECT e.site_id FROM "syslog_events" e WHERE e.id = "siem_events_quarantine"."original_event_id") WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "siem_events_quarantine" SET "site_id" = (SELECT min(id) FROM "sites" WHERE "is_active" = true) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "siem_dashboard_snapshots" SET "site_id" = (SELECT min(id) FROM "sites" WHERE "is_active" = true) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "siem_rules" SET "site_id" = (SELECT min(id) FROM "sites" WHERE "is_active" = true) WHERE "site_id" IS NULL;--> statement-breakpoint
UPDATE "siem_settings" SET "site_id" = (SELECT min(id) FROM "sites" WHERE "is_active" = true) WHERE "site_id" IS NULL;--> statement-breakpoint
