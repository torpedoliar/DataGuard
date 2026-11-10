# WatchGuard EPDR — Implementation Plan (index)

Status: **T01 implemented (read-only client + transport guard); T02–T11 not started** · Spec: [`../../specs/2026-11-09-watchguard-epdr-integration-design.md`](../../specs/2026-11-09-watchguard-epdr-integration-design.md)

The spec owns *what* and *why*. This folder owns *how* and *in which order*. [REQUIREMENTS.md](REQUIREMENTS.md) maps the user's requests to tickets and names blocked capabilities; [CONTRACTS.md](CONTRACTS.md) owns shared safety/data/state contracts that every ticket consumes. Read both before your ticket. The contracts resolve earlier draft ambiguities; if any ticket contradicts them, stop and report the conflict. All SQL snippets are design sketches, not migration-ready scripts: implement constraints, indexes, and Drizzle definitions together, then validate on an isolated database.

## Binding restriction — WatchGuard READ-ONLY

Latest user instruction: **do not change anything on the WatchGuard server**. Read [READ_ONLY_SAFEGUARD.md](READ_ONLY_SAFEGUARD.md) FIRST. It supersedes every earlier ticket/contract implying real provider writes. Implement fail-closed transport guard in T01; only allowlisted reads and exact OAuth token POST are permitted. Scan/repair/reboot/status/comments and other writes remain mock-only/blocked; approval/UI/config cannot unlock them. No live command acceptance is marked done. Local dc-check code and Incident changes remain permitted within original scope.

## How to work a ticket

1. Read this README, REQUIREMENTS and CONTRACTS, then your ticket and its cited spec sections; other tickets only when a dependency interface needs clarification.
2. Confirm every ticket in **Depends on** is `done` in the table below. If not, stop.
3. Implement exactly the ticket scope. Work outside it goes to **Follow-ups** in your hand-off note.
4. Ticket is done when every **Acceptance** checkbox is true and `npm run test`, `npm run lint`, `npm run typecheck` are green on the full suite.
5. Update the ticket's row below to `done`, and append a hand-off note to the ticket file (`## Hand-off`): files touched, migration tag, deviations, follow-ups.

## Tickets

| # | Ticket | Depends on | Status |
|---|---|---|---|
| T01 | [WatchGuard API client](T01-api-client.md) | — | done |
| T02 | [Per-site connection + global controls](T02-connection-settings.md) | T01 | done |
| T03 | [Endpoint sync worker + Monitor › Endpoint Security](T03-endpoint-sync.md) | T02 | done |
| T04 | [Incident schema: endpoint-only incidents](T04-incident-schema.md) | T03 | done (core) |
| T05 | [Detection ingest → Incident DC + Threats page](T05-detection-ingest.md) | T03, T04 | done (core) |
| T06 | [Response rules + simulation mode](T06-rules-simulation.md) | T05 | done (core) |
| T07 | [Action engine: approval + scan dispatch + task tracking](T07-action-engine.md) | T06 | done (core) |
| T08 | [Verification, auto-close, reopen, automatic mode](T08-verification-autoclose.md) | T07 | done (core) |
| T09 | [Protection health ladder](T09-protection-health.md) | T08 | done (core) |
| T10 | [Advanced actions (isolate, ThreatSync commands)](T10-advanced-actions.md) | T09 | done (core) |
| T11 | [Operational UI completion, rollout and handoff](T11-operations-release.md) | T10 | done (core) |

Use this sequence for schema and shared-contract changes. An agent may research or prepare isolated tests in parallel, but one owner merges `db/schema.ts`, migrations/journal, shared contracts, and this index. T04 now follows T03 so it ships a real endpoint FK and null-device compatibility in one complete change; T09 follows T08 so health closure reuses verified lifecycle controls.

## Golden rules (all tickets)

These are invariants. A change that breaks one is wrong even if tests pass.

1. **Site isolation.** Every query and mutation resolves `site_id` server-side from the session (`requireActiveSiteAction` / `requireActiveSiteAdminAction` / `requireSuperadminAction` in `lib/action-auth.ts`) or from the connection row. Client-submitted site, account, endpoint, or connection IDs are looked up and checked against that site.
2. **One connection per site.** `watchguard_connections.site_id` is unique (spec D1).
3. **Secrets stay server-side.** Credentials are encrypted with `encryptString` / read with `decryptString` from `lib/crypto.ts` (strict — never `decryptIfEncrypted`). UI receives only `configured: boolean`. Logs, audit details, errors, and stored provider bodies are redacted (token, password, API key, `Authorization` header).
4. **Mocked provider in tests.** No test, script, or agent run sends a request to WatchGuard. Live calls happen only through the running worker or the UI test button with credentials an operator entered.
5. **Writes are typed.** Endpoint commands go only through the action engine (T07). Incident status/comments go through the separate durable provider-sync outbox (T07/T08). Both use server-built, allowlisted requests, current account revision, permissions and kill-switch checks; no free-form URL/payload. OAuth token POST is authentication, not an endpoint command.
6. **Approval guardrail.** Server, unknown device type, critical endpoint/linked asset, or `no_auto` → automatic action requires approval, re-checked at dispatch. An endpoint identified by WatchGuard and assigned to its connection's site needs no asset registration. An unresolved provider target is blocked until identity/site validation, not dispatchable merely because somebody approved it. Simulation stays simulation even on a protected target.
7. **Accepted ≠ done.** Provider acceptance (`task_id`, `processed_device_ids`, action `id`) moves state to `dispatched`/`in_progress`, never to resolved. Resolution requires verification (T08).
8. **Unknown outcome is not retried.** A write that timed out or failed without a clear provider answer goes to `outcome_unknown` and is reconciled by reading `/tasks`; it is never re-sent automatically.
9. **Kill switches win.** Global and site kill switches are checked immediately before every dispatch.
10. **Headless audit.** Workers audit with `logAuditManual` (`lib/audit.ts`) including `siteId`; `logAudit` is for request context only.

## Shared conventions

**Module layout** (create as tickets need them):

```text
lib/watchguard/          client.ts, auth.ts, types.ts, schemas.ts (zod), regions.ts, errors.ts, fixtures/
lib/epdr/                sync.ts, detections.ts, correlation.ts, rules.ts, policy.ts,
                         actions.ts (state machine), dispatcher.ts, verification.ts, health.ts
actions/                 watchguard-settings.ts, epdr-*.ts (server actions)
components/admin/epdr/   UI components
app/[locale]/(dashboard)/admin/epdr/   pages
scripts/watchguard-worker.ts
```

**Routes** (navigation group "Security" in `lib/ui/navigation.ts`):

| Route | Page | Access |
|---|---|---|
| `/admin/settings` (WatchGuard card) | Connection per site, global kill switch | superadmin |
| `/admin/epdr` | Monitor › Endpoint Security | site staff read, admin act |
| `/admin/epdr/threats` | Threats + approval queue | site staff read, admin act |
| `/admin/epdr/settings` | Site rules, health ladder, safeguards, site kill switch | site admin |

**Migrations.** Hand-written SQL in `drizzle/` plus a `drizzle/meta/_journal.json` entry, applied by `npm run db:migrate`. Take the next free index at the time you work (journal currently ends at `0063_facility_room_layout`). Never run `drizzle-kit generate`/`push` (see `AGENTS.md`). Mirror every SQL change in `db/schema.ts`. One migration per ticket, tagged `NNNN_epdr_<topic>`.

**i18n.** UI strings go to `messages/en.json` and `messages/id.json` under namespace `Epdr` (navigation labels under `Nav`).

**Tests.** Vitest, colocated `*.test.ts(x)`. Follow `actions/ncm-settings.test.ts` (auth matrix, secret preservation) and `lib/ncm-ingest.test.ts` (dependency-injected processing). Provider responses come from fixtures in `lib/watchguard/fixtures/` built from the OpenAPI examples, corrected to valid JSON.

**Time.** Store timestamps in UTC (`timestamp` columns, `new Date()`); compare windows in milliseconds.

## Verified provider facts

Single source for agents; the spec §3 has the full tables.

- Region hosts: `api.jpn.cloud.watchguard.com`, `api.deu.cloud.watchguard.com`, `api.usa.cloud.watchguard.com`. Token: `POST https://{host}/oauth/token`, Basic `accessId:password`, body `grant_type=client_credentials&scope=api-access`, `expires_in` 3600.
- API calls: headers `Authorization: Bearer <token>`, `WatchGuard-API-Key: <key>`, `Accept/Content-Type: application/json`.
- Endpoint Security base: `https://{host}/rest/endpoint-security/management/api/v1/accounts/{accountId}`. Paging verified live with `$top`, `$skip`, `$count=true` (response `data[]`, `total_items`). Max 3,000 per page.
- ThreatSync base: `https://{host}/rest/threatsync/management/v1/{accountId}`. Incidents list: `limit` ≤ 500, `startAfter` cursor with `sortBy`, `duration` like `7D`. Response `items[]`, `count`.
- Recorded live check on the supplied subscriber account: auth, accounts, licenses, devices (613), protection status, ThreatSync incidents all 200. Earlier credentials returned 401 (`Undefined`) / 403 (11002); their root cause was not established. Site ownership/name must be confirmed in the UI, not inferred from a screenshot. Dates in filenames are planning labels, not evidence of a verified execution date.
- OpenAPI files: `management-1.5.2.yaml`, `threatsync-management-1.2.0.yaml` (links in spec §15). When a field or enum matters, read the YAML, not the HTML page — the HTML is truncated and its examples are invalid JSON.

## Stop and ask

Report back instead of improvising when:

- The provider schema contradicts a ticket (field missing, enum value different).
- A golden rule cannot be met inside the ticket scope.
- A migration would rewrite or drop existing data beyond what the ticket states.
- An existing test must be deleted or weakened to pass.
