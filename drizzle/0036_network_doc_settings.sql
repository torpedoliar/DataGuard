-- Network Docs sync settings on global_settings.
-- The sync worker + admin action read these from the DB (env NETWORK_DOC_*
-- still wins when set). network_doc_api_key is encrypted at rest with
-- lib/crypto.ts (AES-256-GCM, same as siemSettings.ai_api_key) — never plain.
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "network_doc_url" text;
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "network_doc_api_key" text;
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "network_doc_site_id" integer;
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "network_doc_interval_ms" integer;
