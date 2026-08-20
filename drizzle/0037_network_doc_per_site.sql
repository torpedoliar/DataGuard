-- Per-site network-doc configurations. Each dc-check site may point at its
-- own network-doc API instance. env NETWORK_DOC_URL / NETWORK_DOC_API_KEY act
-- as a GLOBAL DEFAULT when a site has no row (or an empty field) — a site's
-- row overrides the env so multi-API deployments work.
CREATE TABLE IF NOT EXISTS "network_doc_settings" (
    "site_id" integer PRIMARY KEY NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "url" text,
    "api_key" text,
    "interval_ms" integer,
    "updated_at" timestamp DEFAULT now()
);

-- Carry the pre-multi-site global config (0036) into the new per-site model
-- so the operator's existing single-API setup keeps working unchanged.
INSERT INTO "network_doc_settings" ("site_id", "url", "api_key", "interval_ms")
SELECT "network_doc_site_id", "network_doc_url", "network_doc_api_key", "network_doc_interval_ms"
FROM "global_settings"
WHERE "network_doc_site_id" IS NOT NULL
  AND "network_doc_url" IS NOT NULL
ON CONFLICT ("site_id") DO NOTHING;