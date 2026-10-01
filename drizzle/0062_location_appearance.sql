-- 3D room appearance per location: light tint + brightness and the wall
-- finish (built-in pattern or uploaded image). All nullable; null keeps the
-- default look.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "light_color" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "light_brightness" real;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wallpaper" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wallpaper_path" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wallpaper_mode" text;
