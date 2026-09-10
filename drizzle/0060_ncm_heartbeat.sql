-- Ticket 09: fleet heartbeat worker per site. status is the last heartbeat
-- outcome (online|offline, default online); miss_count counts consecutive
-- failed checks. lib/ncm-heartbeat.ts flips status to offline at
-- NCM_OFFLINE_THRESHOLD (3) and files/keeps the High incident from there.
ALTER TABLE "ncm_settings" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'online';
ALTER TABLE "ncm_settings" ADD COLUMN IF NOT EXISTS "miss_count" integer DEFAULT 0;
