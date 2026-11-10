# T02 — Per-site connection + global controls

Depends on: T01 · Spec: D1, §9.1, §9.2 (1), §10, §11 · Migration: `NNNN_epdr_connections`

## Goal

Superadmin configures one WatchGuard connection per site from the UI, tests it per service, and controls the global kill switch.

## Data model

```sql
CREATE TABLE watchguard_connections (
  id serial PRIMARY KEY,
  site_id integer NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  region text NOT NULL,                -- 'jpn' | 'deu' | 'usa' (CHECK)
  account_id text NOT NULL,            -- e.g. WGC-3-...
  api_key text,                        -- encrypted
  rw_access_id text, rw_password text, -- password encrypted
  ro_access_id text, ro_password text, -- password encrypted
  endpoint_sync_minutes integer NOT NULL DEFAULT 15,
  detection_sync_minutes integer NOT NULL DEFAULT 5,
  last_test_at timestamp,
  last_test_result jsonb,              -- per-service status, redacted
  last_endpoint_sync_at timestamp,
  last_detection_sync_at timestamp,
  last_sync_error text,                -- redacted
  created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
);

CREATE TABLE watchguard_global_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  kill_switch boolean NOT NULL DEFAULT false,
  allowed_actions text[] NOT NULL DEFAULT ARRAY['scan']::text[],  -- ceiling for every site
  max_actions_per_hour_per_site integer NOT NULL DEFAULT 30,
  updated_by integer REFERENCES users(id), updated_at timestamp DEFAULT now()
);
INSERT INTO watchguard_global_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
```

Allowed action values across the project: `scan`, `reboot`, `assign_config`, `isolate`, `unisolate`, `ts_kill_process`, `ts_quarantine`, `ts_block_ip`, `ts_unblock_ip`. Define them once as a const in `lib/epdr/action-types.ts`.

## Server

`lib/watchguard/connection.ts`:
- `resolveConnection(siteId, mode: "read" | "write")` → `WatchGuardCredentials` built from the row. `read` prefers RO credentials and falls back to RW; `write` requires RW. Throws a typed error when not configured or disabled.
- `testConnection(siteId)` → `{ auth, account, endpointSecurity, threatSync }` each `{ ok, status, kind, message }`, using GET calls only (token, `getAccount`, `getLicenses`, `listIncidents({ limit: 1 })`). Run for RO and RW credentials separately when both are set.

`actions/watchguard-settings.ts` (all `requireSuperadminAction`):
- `getWatchGuardSettings()` → global settings + per-site rows with `apiKeyConfigured`, `rwConfigured`, `roConfigured` booleans, never secret values.
- `saveWatchGuardConnection(prev, formData)` — zod validation; blank secret field keeps the stored value (pattern: `actions/ncm-settings.ts`); region from the allowlist; intervals validated (endpoint5–1440, detection2–60; out-of-range values rejected with UI error).
- `testWatchGuardConnection(siteId)` — stores `last_test_at/result`.
- `saveWatchGuardGlobal(prev, formData)` — kill switch, allowed actions, hourly cap.
- Every mutation: `logAudit` with redacted detail, `revalidatePath`.

## UI

`components/admin/epdr/watchguard-settings-form.tsx`, mounted as a card on `/admin/settings` after the NCM card:
- Global block: kill switch toggle (red banner when on), allowed actions checklist, hourly cap.
- Per site row: enabled, region select, Account ID, API key, RW access ID + password, RO access ID + password, intervals, "Test connection" button with four service badges and timestamp.

## Shared-contract completion

Implement CONTRACTS C1/C8 in this ticket: account/credential revisions, unique account binding, encrypted IDs if the spec requires them, explicit clear/rotate, account-change disable/retest, cache invalidation and per-service capability flags. `testConnection` resolves a disabled draft for diagnostics without enabling background jobs; token success does not label writes as verified. Reject out-of-range form values with validation messages (do not silently clamp).

Add global UI-backed settings for simulation minimum days, auto-close category/score ceiling and approval/exclusion validity limits. Defaults are recommendations; read current values from DB in later tickets. Connection UI also owns task polling interval and activation/backfill boundary. Clearing credentials or disabling never removes prior Incident/evidence rows.

Acceptance additions: disabled draft can be tested; changing account leaves old queued commands invalid and old endpoints archived; rotating password invalidates cached tests/tokens; duplicate region/account binding across sites is rejected; no secret appears in audit/error props.

## Out of scope

Sync, workers, site-level rules (T06).

## Acceptance

- [x] Migration applies on a database at the current journal head; `db/schema.ts` mirrors it.
- [x] Non-superadmin gets "Unauthorized" from every action; no secret value ever reaches the client or audit log.
- [x] Saving with blank secret fields preserves stored secrets; stored secrets are `encryptString` envelopes.
- [x] A second connection for the same site is rejected.
- [x] Test result shows each service separately (a 403 on ThreatSync with 200 elsewhere renders as partial).

## Tests

- `actions/watchguard-settings.test.ts`: auth matrix, secret preservation, encryption, region allowlist, interval validation, unique site/account and revision-safe rotation.
- `lib/watchguard/connection.test.ts`: RO/RW resolution, disabled connection, per-service test result with mocked client failures.

## Hand-off

**Status:** `done` — per-site connection + superadmin global controls, read-only provider-boundary only. No live provider calls (test mocks `testConnection`).

**Files added/changed:** `drizzle/0064_epdr_connections.sql` + journal entry (idx 64), `db/schema.ts` (`watchguardConnections`, `watchguardGlobalSettings`), `lib/epdr/action-types.ts`, `lib/watchguard/connection.ts` (`resolveWatchGuardConnection`, `runServiceChecks`, `testConnection`), `actions/watchguard-settings.ts` (`getWatchGuardSettings`, `saveWatchGuardConnection`, `clearWatchGuardSecrets`, `testWatchGuardConnection`, `saveWatchGuardGlobal`), `components/admin/epdr/watchguard-settings-form.tsx`, mounted on `app/[locale]/(dashboard)/admin/settings/page.tsx`.

**Deviation from ticket:** `resolveWatchGuardConnection` returns a discriminated union result (`{ ok:false, reason }`) rather than throwing, matching the codebase's `requireActiveSiteAction`/`resolveNcmConfig` idiom. Extra C1/C8 columns added (`credential_revision`, `account_revision`, `simulation_min_days`, `auto_close_*`, `approval_expiry_hours`, `exclusion_max_days`) beyond the minimal ticket SQL, as required by "Shared-contract completion". Explicit secret clear is a dedicated action (`clearWatchGuardSecrets`), separate from rotation on save.

**Deviation note — i18n:** admin settings form uses hardcoded bilingual strings following the existing `ncm-settings-form.tsx` pattern; the `Epdr` message namespace is reserved for site-facing pages (T03+).

**Validation:** `npm run test` green on the new files (100 watchguard+settings tests), `npm run typecheck` clean, `npm run lint` 0 errors (only pre-existing/`_args`-idiom warnings).

**Follow-ups:** T03 endpoint sync uses `resolveWatchGuardConnection` (read mode) + `watchguard_connections.last_endpoint_sync_at`; write-mode resolution stays locked until an explicit future unlock.
