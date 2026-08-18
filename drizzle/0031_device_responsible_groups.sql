-- Align the per-device PIC group storage with the JSONB schema type.
-- Migration 0029 added the equivalent users column but omitted devices.responsible_groups.
-- IF NOT EXISTS keeps this safe for databases where the column was provisioned manually.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "responsible_groups" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
