-- Additive only: existing devices and room layouts remain unchanged.
ALTER TABLE devices ADD COLUMN asset_type text NOT NULL DEFAULT 'standard';
ALTER TABLE devices ADD COLUMN facility_specs jsonb;
ALTER TABLE devices ADD COLUMN floor_x real;
ALTER TABLE devices ADD COLUMN floor_z real;
ALTER TABLE devices ADD COLUMN floor_rotation real;
ALTER TABLE devices ADD CONSTRAINT devices_asset_type_check CHECK (asset_type IN ('standard', 'pac', 'ups'));
ALTER TABLE devices ADD CONSTRAINT devices_facility_rack_check CHECK (
  asset_type = 'standard' OR (rack_name IS NULL AND rack_position IS NULL AND u_height IS NULL)
);
ALTER TABLE devices ADD CONSTRAINT devices_floor_placement_check CHECK (
  (floor_x IS NULL AND floor_z IS NULL AND floor_rotation IS NULL)
  OR (asset_type <> 'standard' AND location_id IS NOT NULL
      AND floor_x IS NOT NULL AND floor_z IS NOT NULL AND floor_rotation IS NOT NULL
      AND floor_x BETWEEN -1000 AND 1000 AND floor_z BETWEEN -1000 AND 1000
      AND floor_rotation >= 0 AND floor_rotation < 360)
);
ALTER TABLE racks ADD COLUMN floor_x real;
ALTER TABLE racks ADD COLUMN floor_z real;
ALTER TABLE racks ADD COLUMN floor_rotation real;
ALTER TABLE racks ADD CONSTRAINT racks_floor_placement_check CHECK (
  (floor_x IS NULL AND floor_z IS NULL AND floor_rotation IS NULL)
  OR (location_id IS NOT NULL AND floor_x IS NOT NULL AND floor_z IS NOT NULL AND floor_rotation IS NOT NULL
      AND floor_x BETWEEN 0 AND 1000 AND floor_z BETWEEN 0 AND 1000
      AND floor_rotation >= 0 AND floor_rotation < 360)
);
ALTER TABLE locations ADD COLUMN room_width_m real;
ALTER TABLE locations ADD COLUMN room_depth_m real;
ALTER TABLE locations ADD COLUMN room_height_m real;
ALTER TABLE locations ADD COLUMN layout_mode text NOT NULL DEFAULT 'legacy';
ALTER TABLE locations ADD COLUMN layout_revision integer NOT NULL DEFAULT 0;
ALTER TABLE locations ADD CONSTRAINT locations_layout_check CHECK (
  layout_mode IN ('legacy', 'manual') AND layout_revision >= 0
  AND (room_width_m IS NULL OR (room_width_m > 0 AND room_width_m <= 1000))
  AND (room_depth_m IS NULL OR (room_depth_m > 0 AND room_depth_m <= 1000))
  AND (room_height_m IS NULL OR (room_height_m > 0 AND room_height_m <= 100))
  AND (layout_mode = 'legacy' OR (room_width_m IS NOT NULL AND room_depth_m IS NOT NULL AND room_height_m IS NOT NULL))
);
