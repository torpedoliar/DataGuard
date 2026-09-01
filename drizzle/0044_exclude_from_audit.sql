-- Exclude controls (batch: fix audit percent >100% + include/exclude toggles):
--
--   devices.exclude_checklist  — exclude a device from the checklist audit
--       population (form, grid, dashboard, reports) but NOT from the device
--       inventory or the rack layout (physical map stays intact). Default
--       false so no device vanishes until an admin opts in.
--
--   locations.exclude_temp_check — exclude a room's temperature input from
--       the audit form even when it has a threshold. Default false.
--
-- Both fixes the >100% completion bug at its root: every count (dashboard
-- checkedToday / categoryStats / dailyCompletion, audit grid, report
-- analytics + listings) now uses the SAME population as the denominator —
-- auditable racks AND not excluded — so checkedToday can never exceed
-- totalDevices again.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "exclude_checklist" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "exclude_temp_check" boolean DEFAULT false;--> statement-breakpoint
