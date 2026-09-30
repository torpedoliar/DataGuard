-- 3D rack layout: physical grid position per rack (row letter, slot number
-- within the row, which way the front door faces) and an optional floor-plan
-- image per room used as the 3D floor texture. All nullable; unplaced racks
-- are auto-arranged by components/rack3d/layout.ts.
ALTER TABLE "racks" ADD COLUMN IF NOT EXISTS "floor_row" text;
ALTER TABLE "racks" ADD COLUMN IF NOT EXISTS "floor_slot" integer;
ALTER TABLE "racks" ADD COLUMN IF NOT EXISTS "facing" text DEFAULT 'front';
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "floor_plan_path" text;
