-- Ticket 06: per-site NCM webhook secret for POST /api/ncm/ingest.
-- HMAC-SHA256 key (X-NCM-Signature: sha256=<hex>) NCM uses to sign event
-- deliveries to this site. Stored encrypted at rest via lib/crypto.ts
-- (AES-256-GCM v1 envelope, same as admin_api_key / network_doc api_key).
-- Nullable: a site without a secret simply fails every ingest (fail closed).
ALTER TABLE "ncm_settings" ADD COLUMN IF NOT EXISTS "webhook_secret" text;
