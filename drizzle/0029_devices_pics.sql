-- Add responsible_for_groups to users, plus the device_groups / device_pics
-- tables the PIC feature needs. Mirrors db/schema.ts exactly.
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "responsible_for_groups" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#3b82f6',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_pics" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_pics_device_group_unique') THEN
		ALTER TABLE "device_pics" ADD CONSTRAINT "device_pics_device_group_unique" UNIQUE ("device_id","group_id");
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_groups_site_id_device_groups_id_fk') THEN
		ALTER TABLE "device_groups" ADD CONSTRAINT "device_groups_site_id_device_groups_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_pics_device_id_device_pics_device_id_fk') THEN
		ALTER TABLE "device_pics" ADD CONSTRAINT "device_pics_device_id_device_pics_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_pics_group_id_device_pics_group_id_fk') THEN
		ALTER TABLE "device_pics" ADD CONSTRAINT "device_pics_group_id_device_pics_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "device_groups"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_pics_site_id_device_pics_site_id_fk') THEN
		ALTER TABLE "device_pics" ADD CONSTRAINT "device_pics_site_id_device_pics_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;