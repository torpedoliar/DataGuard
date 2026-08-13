-- Simplify audit status: OK / Warning / Error -> OK / NOT OK
-- Merge both failure states into a single "NOT OK" value.
-- Pattern: UPDATE rows first (can't cast Warning/Error into a type that no
-- longer holds them), then convert column to text, drop old enum, recreate,
-- cast back. Mirrors 0009_siem_alert_channel_telegram_only.sql.

-- 1. Merge existing failure values
UPDATE "checklist_items" SET "status" = 'NOT OK' WHERE "status" = 'Warning';
UPDATE "checklist_items" SET "status" = 'NOT OK' WHERE "status" = 'Error';--> statement-breakpoint

-- 2. Convert column to text (drops enum type dependency)
ALTER TABLE "checklist_items" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint

-- 3. Drop old enum
DROP TYPE "public"."status";--> statement-breakpoint

-- 4. Recreate with two values
CREATE TYPE "public"."status" AS ENUM('OK', 'NOT OK');--> statement-breakpoint

-- 5. Cast text back to new enum
ALTER TABLE "checklist_items" ALTER COLUMN "status" SET DATA TYPE "public"."status" USING "status"::"public"."status";--> statement-breakpoint
