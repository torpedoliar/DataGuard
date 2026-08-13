-- Simplify audit status: OK / Warning / Error -> OK / NOT OK
-- Merge both failure states into a single "NOT OK" value.
-- ORDER MATTERS: convert the column to text FIRST, because `UPDATE ... SET
-- status = 'NOT OK'` is rejected while the column is still the old enum
-- (OK/Warning/Error has no 'NOT OK' member). After the text conversion the
-- values are mergeable, then the type can be reconstructed around them.

-- 1. Convert column to text (drops enum type dependency)
ALTER TABLE "checklist_items" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint

-- 2. Merge existing failure values
UPDATE "checklist_items" SET "status" = 'NOT OK' WHERE "status" = 'Warning';
UPDATE "checklist_items" SET "status" = 'NOT OK' WHERE "status" = 'Error';--> statement-breakpoint

-- 3. Drop old enum
DROP TYPE "public"."status";--> statement-breakpoint

-- 4. Recreate with two values
CREATE TYPE "public"."status" AS ENUM('OK', 'NOT OK');--> statement-breakpoint

-- 5. Cast text back to new enum
ALTER TABLE "checklist_items" ALTER COLUMN "status" SET DATA TYPE "public"."status" USING "status"::"public"."status";--> statement-breakpoint