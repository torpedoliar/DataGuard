-- Ticket 08: outbound webhook URL pushed to NCM per site (lib/ncm.ts
-- setNcmWebhook). DG's own public ingest URL (https://<dg>/api/ncm/ingest),
-- plaintext like ncm_settings.url — not a secret; the HMAC key stays in
-- webhook_secret (0058, encrypted at rest).
ALTER TABLE "ncm_settings" ADD COLUMN IF NOT EXISTS "webhook_url" text;
