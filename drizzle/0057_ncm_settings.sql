-- Per-site NCM (network configuration manager) settings. Each dc-check site
-- may point at its own NCM API instance for switch backups/reviews.
-- admin_api_key is encrypted at rest with lib/crypto.ts (AES-256-GCM, same as
-- network_doc_settings.api_key) — never plain. last_seen_at is the heartbeat
-- written when a site's connection is last verified/used.
CREATE TABLE IF NOT EXISTS "ncm_settings" (
    "site_id" integer PRIMARY KEY NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "url" text,
    "admin_api_key" text,
    "last_seen_at" timestamp,
    "updated_at" timestamp DEFAULT now()
);
