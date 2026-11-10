-- EPDR endpoint inventory + sync run bookkeeping (T03). One endpoint row per
-- (connection, provider device_id); device_id is an optional same-site asset
-- link (spec D2), set null when the asset is removed so the endpoint never
-- orphans. raw keeps the last provider object for diagnosis.
CREATE TABLE IF NOT EXISTS "epdr_endpoints" (
    "id" serial PRIMARY KEY,
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id") ON DELETE cascade,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "wg_device_id" text NOT NULL,
    "host_name" text NOT NULL,
    "ip_address" text,
    "mac_addresses" jsonb,
    "platform_id" integer,
    "operating_system" text,
    "device_type" integer,
    "agent_version" text,
    "wg_site_name" text,
    "group_path" text,
    "security_configuration_id" text,
    "security_configuration_name" text,
    "isolation_state" integer,
    "license_status" integer,
    "encryption" jsonb,
    "last_connection_at" timestamp,
    "accumulated_protection_status" integer,
    "adaptive_defense_status" integer,
    "file_antivirus_status" integer,
    "firewall_status" integer,
    "protection_engine_update_status" integer,
    "protection_engine_version" text,
    "knowledge_catalog_update_status" integer,
    "knowledge_catalog_date" timestamp,
    "reboot_requested" boolean,
    "reinstall_protection_requested" boolean,
    "reinstall_agent_requested" boolean,
    "reinstall_protection_error" jsonb,
    "reinstall_agent_error" jsonb,
    "device_id" integer REFERENCES "devices"("id") ON DELETE set null,
    "is_critical" boolean NOT NULL DEFAULT false,
    "no_auto" boolean NOT NULL DEFAULT false,
    "first_seen_at" timestamp NOT NULL DEFAULT now(),
    "last_synced_at" timestamp NOT NULL,
    "removed_at" timestamp,
    "raw" jsonb,
    UNIQUE ("connection_id", "wg_device_id")
);

CREATE INDEX IF NOT EXISTS "epdr_endpoints_site_protection_idx" ON "epdr_endpoints" ("site_id", "accumulated_protection_status");
CREATE INDEX IF NOT EXISTS "epdr_endpoints_site_host_idx" ON "epdr_endpoints" ("site_id", "host_name");

CREATE TABLE IF NOT EXISTS "epdr_sync_runs" (
    "id" serial PRIMARY KEY,
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id") ON DELETE cascade,
    "kind" text NOT NULL,
    "started_at" timestamp NOT NULL,
    "finished_at" timestamp,
    "status" text NOT NULL,
    "stats" jsonb,
    "error" text
);

-- Separate unmanaged inventory (status=2 == Installing here, but a distinct
-- population never merged into the managed endpoint totals until verified).
CREATE TABLE IF NOT EXISTS "epdr_unmanaged_devices" (
    "id" serial PRIMARY KEY,
    "connection_id" integer NOT NULL REFERENCES "watchguard_connections"("id") ON DELETE cascade,
    "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
    "wg_unmanaged_id" text NOT NULL,
    "host_name" text,
    "ip_address" text,
    "mac_address" text,
    "status" integer,
    "installation_error" text,
    "last_seen_at" timestamp,
    "last_synced_at" timestamp NOT NULL,
    "raw" jsonb,
    UNIQUE ("connection_id", "wg_unmanaged_id")
);