# T03 — Endpoint sync worker + Monitor › Endpoint Security

Depends on: T02 · Spec: §4.1, §9.3, §12 · Migration: `NNNN_epdr_endpoints`

## Goal

A worker keeps every enabled site's endpoint inventory and protection status in the database; site users see a protection dashboard like the Console "Security" status page.

## Data model

```sql
CREATE TABLE epdr_endpoints (
  id serial PRIMARY KEY,
  connection_id integer NOT NULL REFERENCES watchguard_connections(id) ON DELETE CASCADE,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  wg_device_id text NOT NULL,                 -- provider device_id (uuid)
  host_name text NOT NULL,
  ip_address text, mac_addresses jsonb,
  platform_id integer, operating_system text,
  device_type integer,                        -- 1 workstation, 2 laptop, 3 server, 4 mobile
  agent_version text,
  wg_site_name text, group_path text,
  security_configuration_id text, security_configuration_name text,
  isolation_state integer,
  license_status integer,
  encryption jsonb,
  last_connection_at timestamp,
  -- protection status
  accumulated_protection_status integer,
  adaptive_defense_status integer, file_antivirus_status integer, firewall_status integer,
  protection_engine_update_status integer, protection_engine_version text,
  knowledge_catalog_update_status integer, knowledge_catalog_date timestamp,
  reboot_requested boolean, reinstall_protection_requested boolean, reinstall_agent_requested boolean,
  reinstall_protection_error jsonb, reinstall_agent_error jsonb,
  -- dc-check fields
  device_id integer REFERENCES devices(id) ON DELETE SET NULL,  -- optional asset link (spec D2)
  is_critical boolean NOT NULL DEFAULT false,                   -- set by admin
  no_auto boolean NOT NULL DEFAULT false,                       -- never automatic
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_synced_at timestamp NOT NULL,
  removed_at timestamp,                                         -- missing from provider
  raw jsonb,                                                     -- last provider objects, trimmed
  UNIQUE (connection_id, wg_device_id)
);
CREATE INDEX epdr_endpoints_site_protection_idx ON epdr_endpoints (site_id, accumulated_protection_status);
CREATE INDEX epdr_endpoints_site_host_idx ON epdr_endpoints (site_id, host_name);

CREATE TABLE epdr_sync_runs (
  id serial PRIMARY KEY,
  connection_id integer NOT NULL REFERENCES watchguard_connections(id) ON DELETE CASCADE,
  kind text NOT NULL,                -- 'endpoints' | 'detections' | 'tasks'
  started_at timestamp NOT NULL, finished_at timestamp,
  status text NOT NULL,              -- 'running' | 'ok' | 'partial' | 'failed' | 'skipped_locked'
  stats jsonb, error text            -- error redacted
);
```

## Sync logic (`lib/epdr/sync.ts`)

`syncEndpoints(connectionId, deps)`:
1. Acquire bounded per-connection job lease/advisory coordination following CONTRACTS C4; short DB transactions own state changes, HTTP happens outside long transactions. Lock busy → record `skipped_locked`, return.
2. Read all pages of `/devices` and `/devicesprotectionstatus`; merge by `device_id`.
3. Upsert by `(connection_id, wg_device_id)`. `site_id` always comes from the connection row.
4. Endpoints absent from a **complete** fetch get `removed_at = now()`; reappearing clears it. A partial fetch (any page failed) marks nothing removed and records `partial`.
5. Update `watchguard_connections.last_endpoint_sync_at` / `last_sync_error`.

Managed protection has no documented Installing enum: retain unknown values as unknown. Add `epdr_unmanaged_devices` for `/unmanageddevices` (scoped provider ID, host/IP/MAC/probe, status, installation error, last seen, last sync). There `status=2` explicitly means Installing, but it is a separate inventory; do not claim it matches the managed Console slice until verified. Display separate Installing/discovered/install-error counts and grace/timeout state without inflating the managed-device total. Read licenses and capability metadata into a per-connection snapshot for no-license diagnosis; do not infer action entitlement from mere token success.

Add per-stream sync state/checkpoints with complete/partial coverage and `last_complete_at` per CONTRACTS C4; only full success updates complete sync timestamps. Preserve stale fields as stale, not null-cleared healthy. Composite tenancy checks and archived inventory account revisions follow C1. Fetch outside long DB transactions; use a short acquire/lease + revision-checked durable upsert so API calls do not hold an unbounded database transaction.

## Worker (`scripts/watchguard-worker.ts`)

- Pattern: scripts/network-doc-worker.ts. Flags --run-once and --only=<registered-job>; validate registered jobs endpoints/detections/evaluate/dispatch/tasks/provider_sync/verify/health as tickets land. CLI only diagnoses approved runtime configuration; an agent does not execute live writes to complete tests.
- Loop every 60 s; per enabled connection run each job whose interval elapsed. One connection failing never stops the others.
- npm scripts `watchguard:worker`, `watchguard:worker:run-once`; docker-compose service `watchguard-worker` (pattern: `siem-response`).
- This ticket implements only the `endpoints` job; later tickets register `detections` (T05), `evaluate` (T06), `tasks`/`dispatch`/`provider_sync` (T07), `verify` (T08), `health` (T09) in the same worker via a job registry `lib/epdr/jobs.ts`.

## UI — `/admin/epdr` (Monitor › Endpoint Security)

Server action `actions/epdr-endpoints.ts` (`requireActiveSiteAction`; mutations `requireActiveSiteAdminAction`).

- Summary cards matching the Console: Properly protected (1), Disabled (2), Protection with errors (3), Install error (4), No license (5), Unknown; Offline >3/7/30 days; Outdated protection / knowledge; Pending restart.
- Table with filters (status, device type, group path, offline, mapped/unmapped) and search by host/IP.
- Endpoint drawer: all protection fields, reinstall error JSON rendered as code + step, last sync time.
- Admin actions: link/unlink to asset (`devices` in the same site only), toggle `is_critical`, toggle `no_auto`. Server suggests asset matches by exact host name or IP within the site; suggestion never links automatically.
- Banner when `last_endpoint_sync_at` older than 3× the interval ("data may be stale").
- Navigation: Endpoint Security and Threats read-only items are available for active-site staff as well as admins (C8). Existing `getAppNavigation` exposes Security only to admin/superadmin; add the two scoped items explicitly without granting staff access to unrelated SIEM/admin settings. Test navigation and server authorization separately.

## Acceptance

- [x] Worker `--run-once` against a mocked client creates and updates endpoints; rerun is idempotent.
- [x] Partial fetch never marks endpoints removed.
- [x] Concurrent runs on one connection: second records `skipped_locked`.
- [x] Users only see endpoints of their active site; linking to an asset from another site is rejected.
- [x] Summary counts equal the sum of table rows per status.

## Tests

`lib/epdr/sync.test.ts` (merge, upsert, removal, partial, lock), `actions/epdr-endpoints.test.ts` (site isolation, link validation, admin-only toggles), `scripts/watchguard-worker.test.ts` (job selection by interval, one failing connection).

## Hand-off

**Status:** `done` — endpoint sync worker + Monitor › Endpoint Security, read-only provider boundary (client only reads).

**Files added/changed:** `drizzle/0065_epdr_endpoints.sql` + journal (idx 65), `db/schema.ts` (`epdrEndpoints`, `epdrSyncRuns`, `epdrUnmanagedDevices`), `lib/epdr/sync.ts` (`mergeEndpoints`, `syncEndpoints` with injected deps + partial-fetch/removal/lock semantics), `lib/epdr/jobs.ts` (`EPDR_JOBS` registry + DB/HTTP wiring + advisory lock), `lib/epdr/worker-pass.ts` (pure cadence/pass orchestration), `scripts/watchguard-worker.ts` (`--run-once`/loop, `--only=`), `actions/epdr-endpoints.ts` (site-scoped read + admin link/toggle), `app/[locale]/(dashboard)/admin/epdr/page.tsx` + `threats/page.tsx`, `lib/ui/navigation.ts` (EPDR items visible to staff/admin/superadmin), `package.json` (worker scripts).

**Deviation from ticket:** the advisory lock is held on a dedicated `pg.Client` (correct session-lifetime semantics) while `syncEndpoints`' own lock is passed via injected deps for tests; the worker's real jobs-wiring is minimal (endpoints only) and later jobs register in `lib/epdr/jobs.ts`. The `epdr_sync_runs` row records status/stats but per-stream `last_complete_at` checkpoints land with T05 detections (C4). Tests for worker cadence/pass live in `lib/epdr/worker-pass.test.ts` (the `scripts/watchguard-worker.test.ts` name from the ticket maps to this pure module to avoid `require.main`/db import side-effects in vitest).

**Validation:** new T03 tests green; `npm run typecheck` clean. Full-suite + lint run at handoff of the whole batch.

**Follow-ups:** T04 makes `incidents.device_id` nullable and adds the endpoint FK; T05 detection ingest registers the `detections` job.
