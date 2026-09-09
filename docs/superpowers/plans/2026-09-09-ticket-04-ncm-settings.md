# Ticket 04 — NCM Settings + lib/ncm.ts + koneksi per site

Date: 2026-09-09
Status: implemented

## Goal

DataGuard needs per-site connectivity to the external NCM (Network Configuration
Manager) app: each site can point at its own NCM instance with an admin API key
(encrypted at rest) and record a `lastSeenAt` heartbeat. NCM exposes read
endpoints (`GET switches` / `backups` / `reviews`, scope `read`, auth
`X-API-Key` or `Bearer`) and write endpoints (ticket 02, later).

## Approach — mirror networkDocSettings (0036/0037) end to end

1. **Migration `drizzle/0057_ncm_settings.sql`** (hand-written — `db:generate`/
   `db:push` are banned, snapshot chain is stale):
   ```sql
   CREATE TABLE IF NOT EXISTS "ncm_settings" (
       "site_id" integer PRIMARY KEY NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
       "url" text,
       "admin_api_key" text,
       "last_seen_at" timestamp,
       "updated_at" timestamp DEFAULT now()
   );
   ```
   Plus a `meta/_journal.json` entry (idx 57, tag `0057_ncm_settings`,
   `when` = 0056's + 1000, version 7, breakpoints true).

2. **`db/schema.ts`**: `ncmSettings` pgTable mirroring `networkDocSettings`
   (siteId PK cascade, url, adminApiKey, lastSeenAt, updatedAt) + one
   `ncmSettings: many(ncmSettings)` line in `sitesRelations`.

3. **`lib/ncm.ts`** following the shape of `lib/network-doc.ts`:
   - `NCM_TIMEOUT_MS = 10_000`, `AbortSignal.timeout`.
   - `resolveNcmConfig(siteId)` → `{ url, adminApiKey }` from the `ncm_settings`
     row; key decrypted via `decryptIfEncrypted` (v1 envelope or legacy
     plaintext). DB down → `{ url: null, adminApiKey: null }` (soft).
     Deliberately **no env fallback** (network-doc has NETWORK_DOC_* because it
     predates per-site rows; NCM is per-site from day one).
   - `ncmGet(config, path)` — GET `${base}/api/v1/ncm/${path}` with `X-API-Key`
     header, 10s timeout, error mapping: fetch failure →
     `Gagal terhubung ke ${url}: …` (URL included: localhost-in-Docker trap),
     non-OK → `NCM API responded <status>: <body≤200>`.
   - One-line wrappers `fetchNcmSwitches/Backups/Reviews(config)` (the read
     endpoints); write endpoints come with ticket 02.
   - `touchNcmLastSeen(siteId)` heartbeat write.

4. **`lib/ncm.test.ts`** (Vitest, colocated) — TDD red first. Error mapping is
   the tested core: connection failure message includes URL, HTTP status is
   surfaced, success returns JSON, config resolution decrypts the stored key
   and soft-fails to nulls, heartbeat writes lastSeenAt. Mock `../db` with the
   same thenable pattern as `lib/network-doc.test.ts`.

5. **`actions/ncm-settings.ts`** mirroring `actions/network-doc-settings.ts`
   (superadmin-gated server actions):
   - `getNcmSettings()` — sites + url + apiKeyConfigured + lastSeenAt; build-time
     soft fail `{ message: "Build" }`.
   - `saveNcmSettings(prevState, formData)` — zod validation, encrypt key with
     `encryptString`, delete row when url+key both empty, `logAudit`.
   - `testNcmConnection(prevState, formData)` — resolve effective config, call
     `fetchNcmSwitches`, on success `touchNcmLastSeen` + `OK` message.
   - No worker-interval action (NCM has no scheduled worker yet — YAGNI).

6. **`components/admin/ncm-settings-form.tsx`** mirroring
   `network-doc-settings-form.tsx` minus the interval block; shows
   `lastSeenAt` per site. Wired into
   `app/[locale]/(dashboard)/admin/settings/page.tsx`.

## Skipped (lazy / YAGNI)

- Env defaults (`NCM_URL` / `NCM_ADMIN_API_KEY`): per-site rows only; add when a
  deployment actually wants a global default.
- Switch/backup/review response schemas: read endpoints verified by HTTP status
  in test-connection; shape-parse when a consumer (ticket 02+) needs fields.
- Sync worker / advisory lock: no scheduled NCM job in this ticket.

## Validation

`npm run check` (lint + test + build) green; commit `feat(ncm): …`, no push.
`graphify-out/` untouched.
