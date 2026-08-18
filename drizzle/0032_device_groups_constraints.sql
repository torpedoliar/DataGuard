-- Finding #72: rename the device_groups site FK. Migration 0029 created it as
-- "device_groups_site_id_device_groups_id_fk" but it references sites(id), so
-- the name is misleading. Drop it and re-add with the correct name and the
-- same ON DELETE / ON UPDATE clauses as the original 0029 definition.
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_groups_site_id_device_groups_id_fk') THEN
		ALTER TABLE "device_groups" DROP CONSTRAINT "device_groups_site_id_device_groups_id_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_groups_site_id_sites_id_fk') THEN
		ALTER TABLE "device_groups" ADD CONSTRAINT "device_groups_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
-- db/schema.ts device_groups.is_active is aligned to NOT NULL DEFAULT true
-- (schema-only change; migration 0029 already created the column as
-- "boolean DEFAULT true NOT NULL", so no SQL is required here).