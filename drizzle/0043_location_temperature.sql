-- Room temperature audit: locations carry a current reading + threshold so
-- the checklist can record the room's temp on every audit and reports can
-- chart it. Optional per location (null = not measured). Threshold default
-- 27°C is applied in app code (not DB) so changing the policy stays app-side.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "temp_c" real;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "temp_threshold_c" real;--> statement-breakpoint
-- Per-entry snapshot: the audit records the measured room temps at submit
-- time; reports read this historical copy, locations.temp_c stays current.
ALTER TABLE "checklist_entries" ADD COLUMN IF NOT EXISTS "location_temps" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
