-- Critical device flag (Q12): feeds the SIEM `critical_device` event tag and
-- the network.interface_down_critical rule. Null-safe default false.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "is_critical" boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "devices_site_is_critical_idx" ON "devices" ("site_id", "is_critical");
