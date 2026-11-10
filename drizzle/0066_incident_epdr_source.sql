-- Incident endpoint-only targets (T04). incidents.device_id becomes nullable
-- and epdr_endpoint_id is an optional WatchGuard endpoint FK. A target must
-- resolve to an asset OR a WatchGuard endpoint (CHECK). source distinguishes
-- manual / checklist / siem / epdr; automation_hold holds EPDR automation.

ALTER TABLE "incidents" ALTER COLUMN "device_id" DROP NOT NULL;

ALTER TABLE "incidents" ADD COLUMN "epdr_endpoint_id" integer REFERENCES "epdr_endpoints"("id") ON DELETE RESTRICT;
ALTER TABLE "incidents" ADD COLUMN "source" text NOT NULL DEFAULT 'manual';
ALTER TABLE "incidents" ADD COLUMN "external_ref" text;
ALTER TABLE "incidents" ADD COLUMN "automation_hold" boolean NOT NULL DEFAULT false;

ALTER TABLE "incidents" ADD CONSTRAINT "incidents_target_check" CHECK ("device_id" IS NOT NULL OR "epdr_endpoint_id" IS NOT NULL);
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_source_check" CHECK ("source" IN ('manual', 'checklist', 'siem', 'epdr'));

-- Backfill source for existing rows (retain device ids and status).
UPDATE "incidents" SET "source" = 'checklist' WHERE "checklist_item_id" IS NOT NULL;
UPDATE "incidents" SET "source" = 'siem' WHERE "source" = 'manual' AND ("description" ILIKE '%SIEM finding%' OR "description" ILIKE 'Created from SIEM finding%');

-- New auto-resolution category for EPDR security closures.
ALTER TYPE "resolution_category" ADD VALUE 'Security';