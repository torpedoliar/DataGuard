# T01 — WatchGuard API client

Depends on: — · Spec: §3.2, §3.3, §12 · Migration: none

## Goal

A server-only, typed, testable client for the WatchGuard Cloud APIs that every later ticket uses. No database, no UI.

## Mandatory first step: read-only transport lock

Implement [READ_ONLY_SAFEGUARD.md](READ_ONLY_SAFEGUARD.md) before client operations. Only route-allowlisted GETs and exact OAuth token POST may reach real network. All write methods listed below are future interfaces/mock-only: real adapter rejects before fetch with WATCHGUARD_READ_ONLY_BLOCKED. No runtime UI/env/config unlock. Acceptance requires zero-fetch tests for every mutating path, OAuth exception validation, unknown GET/redirect rejection and dispatcher/outbox bypass attempts. This overrides earlier write-method implementation instructions.

## Scope

Create `lib/watchguard/`:

| File | Content |
|---|---|
| `regions.ts` | `WATCHGUARD_REGIONS = { jpn, deu, usa }` → host. Only these hosts are ever called. |
| `types.ts` | `WatchGuardCredentials { region, accountId, accessId, password, apiKey }`, result types. |
| `errors.ts` | `WatchGuardError` with `kind`: `auth` (401/400 invalid credentials), `forbidden` (403), `not_found`, `rate_limited` (429), `server` (5xx), `network`, `timeout`, `invalid_response`. Carries `status` and a **redacted** `message`. |
| `auth.ts` | `getToken(creds)` → `{ token, expiresAt }`. In-memory cache keyed by region/account/access ID + credential revision (C1), refresh 5 min before `expires_in`, single in-flight request per key (concurrent callers await the same promise). `invalidateToken(key)` on 401. |
| `client.ts` | `createWatchGuardClient(creds, { fetch?, now? })` with the methods below. Injectable `fetch` and clock for tests. |
| `schemas.ts` | zod schemas for every response used, `.passthrough()` on objects, unknown enum values kept as numbers (never throw on a new enum value; later tickets treat unknown as "needs review"). |
| `fixtures/*.json` | Valid-JSON fixtures per method, derived from the OpenAPI examples. |

### Client methods

Endpoint Security (`/rest/endpoint-security/management/api/v1/accounts/{accountId}`):

- `listDevices({ top, skip, count })`, `listProtectionStatus({ top, skip, count })` — query keys `$top`, `$skip`, `$count` (verified live).
- `iterateDevices()`, `iterateProtectionStatus()` — async generators paging with `$top=1000` until `skip >= total_items` or empty page.
- `getLicenses()`
- `exportSecurityEvents(type, period, { hostname?, top?, skip? })` and complete iterator — `type` ∈ 1,2,4,6,18…; `period` ∈ 1,7; hostname base64-encoded by the client. Complete YAML exposes top/skip; validate per-operation query dialect and page movement (CONTRACTS C4), repeated-page guard and incomplete coverage. Include paged `listUnmanagedDevices` and `listManagedConfigurations` for T03/T09.
- `getSecurityEventCounters(mask)`
- `listTasks({ top, skip, filter })`, `getTaskDetails(type, taskId)`, `listTaskJobs(type, taskId)`, paged `getTaskJobStatus(type, taskId, jobId, paging)` and `getTaskJobResults(type, taskId, jobId, paging)` with complete iterators and recipient validation (C4/C6).
- Writes (used only by T07 dispatcher): `startImmediateScan(body)`, `rebootDevices(deviceIds, countDownType)`, `isolateDevices(body)`, `unisolateDevices(deviceIds)`, `assignConfiguration(configId, deviceIds)`.

ThreatSync (`/rest/threatsync/management/v1/{accountId}`):

- `listIncidents({ limit, duration, sortBy, sortOrder, startAfter, query })`, `iterateIncidents(...)` with `startAfter` cursor.
- `getIncident(id, { includeActions, includeComments })`
- `updateIncidentStatus(id, status: "new" | "read" | "closed", comment?)`
- `addIncidentComment(id, text)`
- Writes for T10 only: `performIncidentAction(id, { command, entityId, parameters })`, `getIncidentAction(id, actionId)`.

Accounts: `getAccount()` → `/rest/platform/accounts/v2/accounts/{accountId}`.

### Transport rules

- Timeout 30 s on the whole exchange including body read; response body capped at 10 MB.
- GET: retry up to 3 times on `network`, `timeout`, 429, 5xx with exponential backoff (1 s, 4 s, 16 s) and `Retry-After` when present.
- POST/PATCH: no blind retry. Timeout/network, possibly accepted 5xx, malformed success and lost response set `outcomeUnknown: true` (CONTRACTS C5); definitive nonacceptance is distinguished. GET 401 refreshes once; write 401 replay requires proof of authentication rejection before acceptance, otherwise leave reconciliation to the engine.
- Token key includes account and credential revision, not just region/access ID. Refuse redirects and encode path components. Normalize documented object/array variants, but unexpected responses stay invalid/incomplete. Test export/status/results paging and null/missing counters explicitly.
- Redaction helper `redactWatchGuard(text, creds)` removes password, apiKey, token, Basic/Bearer header values. Every `WatchGuardError.message` passes through it.

## Out of scope

Database, settings UI, workers, deciding which calls to make.

## Acceptance

- [x] Every method above exists with typed input/output.
- [x] Only hosts from `regions.ts` can be called; an unknown region throws before any request.
- [x] Token cached and shared; refreshed before expiry; one in-flight request for concurrent callers.
- [x] GET retries per rules; POST/PATCH never retried and mark `outcomeUnknown` on timeout/network. *(Read-only supersedes the write half: all POST/PATCH/DELETE are blocked before any fetch, so they never reach a timeout/network path; the `outcomeUnknown` write-reconciliation machinery is future work behind an explicit reviewed unlock, not marked done here.)*
- [x] No credential, token, or API key appears in any thrown error message or log line.
- [x] Unknown enum values parse successfully.

## Tests (`lib/watchguard/*.test.ts`, fake `fetch` + clock)

- Token: request shape (Basic header, form body), caching, refresh at expiry minus 5 min, concurrent dedup, 401 → refresh once.
- Paging: `iterateDevices` stops at `total_items`; handles empty page and `total_items: null`.
- Retry: 429 with `Retry-After`, 503 then 200, timeout on GET retried, timeout on POST not retried and `outcomeUnknown`.
- Error mapping: 400 `Invalid Username/Password` → `auth`; 401 `Undefined` → `auth`; 403 code 11002 → `forbidden`.
- Redaction: secrets injected into a provider error body never reach `message`.
- Schemas: each fixture parses; a fixture with an unknown enum value parses.

## Hand-off

**Status:** `done` — read-only transport guard + typed client shipped, tested green. No migration, no DB, no UI (per scope).

**Files added:**
- `lib/watchguard/regions.ts` — fixed regional hosts + `WatchGuardRegion`.
- `lib/watchguard/types.ts` — `WatchGuardCredentials`, `TokenResult`, `PagedResult`.
- `lib/watchguard/errors.ts` — `WatchGuardError` (kind/status/outcomeUnknown/retryAfterMs), `redactWatchGuard`, `mapHttpStatusToKind`; new `read_only_blocked` kind.
- `lib/watchguard/guard.ts` — **the single read-only transport guard** (`assertWatchGuardRequest`/`classifyOutbound`); exact GET route allowlist + sole `/oauth/token` POST (`grant_type=client_credentials&scope=api-access`) exception; rejects redirect/userinfo/port/encoded-traversal/near-matches before I/O.
- `lib/watchguard/schemas.ts` — passthrough zod schemas, unknown enums kept as numbers.
- `lib/watchguard/auth.ts` — token cache + single-flight `getToken`, `invalidateToken`, `clearTokenCache`.
- `lib/watchguard/client.ts` — `createWatchGuardClient(creds, { fetch, now, sleep, credentialRevision })` with all read methods, paging iterators, and blocked write adapters (`Promise<never>`).
- `lib/watchguard/fixtures/*.json` — valid-JSON provider samples (14 files).
- Tests: `regions`, `errors`, `guard`, `auth`, `client`, `schemas` (`*.test.ts`).

**Deviations from ticket:**
- `mapHttpStatusToKind` maps 400 *and* 401 → `auth` (WatchGuard reports both for invalid credentials); 403 → `forbidden`.
- `getIncidentAction(id, actionId)` uses the incident-scoped `GET …/incidents/{id}/actions/{actionId}`; the account-level `/actions/{actionId}` is also allowlisted (both are read-only). Action-id semantics remain unverified → refine in T10.
- Write `outcomeUnknown` handling is intentionally **not** implemented — the read-only guard blocks every write before network (READ_ONLY_SAFEGUARD supersedes the earlier write transport rules).

**Validation:**
- `npm run test` → 162 files, 1105 passed / 1 pre-existing skip.
- `npm run typecheck` → clean.
- `npm run lint` → 0 errors (remaining warnings are pre-existing across the repo; none in `lib/watchguard`).
- `npm run build` → not run (requires build-time DB/next env; not part of T01 and no behavior depends on it).

**Read-only provenance:** `assertWatchGuardRequest` is called by both the client GET path and the auth token POST; there is no `allowWrites` switch, no env/UI/config unlock. Every mutating method is a blocked adapter throwing `WATCHGUARD_READ_ONLY_BLOCKED` with **zero** fetch calls (proven by `client.test.ts`).

**Follow-ups / not done (next tickets):** T02 connection/settings (first migration, owner for `db/schema.ts` + journal `0064`), T03+ sync/ingest/actions. Any real provider write requires a separate, explicit authorization and a reviewed code change.
