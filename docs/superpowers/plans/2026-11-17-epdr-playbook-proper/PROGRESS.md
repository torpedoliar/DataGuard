# Implementation Progress

This file records verification checkpoints for the RO/RW end-to-end implementation. Each phase is marked complete only after its gate commands ran and their results were recorded here.

No credential, token, account ID, or provider response appears in this file.

## Baseline

| Check | Result |
|---|---|
| `git status` | Clean tracked tree; pre-existing untracked `dataguard-video/`, `.zcode/`, `.claude/worktrees/*`, and this plan folder |
| `npm run typecheck` | pass (exit 0) |
| `npm run test` | pass — 227 files, 2069 passed, 1 skipped |
| `npm run lint` | pass (exit 0) |

## Phase log

### Phase 0 — Baseline

- Goal: understand scope, record a clean baseline before changes.
- Verification: above.
- Not performed: authenticated browser session; live provider calls (forbidden).

### Phase 1 — API contract and capability matrix

- Goal: record the verified write contract per operation so no adapter is built from guesswork.
- Deliverable: `RW_CAPABILITY_MATRIX.md`.
- Evidence: public WatchGuard documentation only (Endpoint Security 1.5.2, ThreatSync 1.2.0, Auth v1). Published YAML downloads returned `application/octet-stream` and were not parsed.
- Excluded: uninstall protection, `/transact` batch, standalone comment, repair, automatic execution, bulk writes.
- Verification: matrix reviewed against the existing guard route list and the client's blocked adapters; every enabled operation has a documented method, path, body, and observation path.
- Deviation recorded: execution-window and custom-message field names were not re-verified, so `window_hours` and `message` are **not** accepted parameters in this release.

### Phase 2 — Security and execution contract

- Goal: fail-closed eligibility, immutable intent, explicit capability vocabulary.
- Files: `lib/epdr/execution-capability.ts`, `execution-request.ts`, `execution-policy.ts`, `execution-payload.ts`, `execution-dispatch.ts`, `execution-reconcile.ts`, `execution-engine.ts`, `capabilities.ts`, `action-types.ts`.
- Tests: `execution-capability.test.ts` (6), `execution-request.test.ts` (16), `execution-policy.test.ts` (24), `execution-payload.test.ts` (11), `execution-dispatch.test.ts` (13), `execution-reconcile.test.ts` (8), `execution-engine.test.ts` (13), `capabilities.test.ts` (17, rewritten).
- Changed test rationale: `capabilities.test.ts` previously asserted every action was `blocked_read_only`. The operator explicitly authorized a gated RW path, so the test now asserts the stronger replacement invariant — an action is `verified_write` only when it exists in `WRITE_OPERATIONS`, every unsupported action carries an explicit reason, and uninstall/transact are absent. No assertion was deleted without a replacement.
- Verification: focused Vitest green; `npx tsc --noEmit` clean.

### Phase 3 — Persistence and migration file

- Goal: durable request, approval, attempt ledger and enablement gates.
- Files: `drizzle/0084_epdr_provider_writes.sql`, `drizzle/meta/_journal.json` (idx 84), `db/schema.ts`.
- Notes: additive, default-off; `NOT VALID` CHECK constraints so pre-existing rows cannot fail the migration; the old global unique on `idempotency_key` is dropped and replaced by a partial unique index scoped to active states.
- Verification: `npx tsc --noEmit` clean; `_journal.json` parses as JSON.
- Not performed: the migration was **not** applied to any database.

### Phase 4 — Typed write adapter

- Goal: a separate write boundary that cannot express an arbitrary request.
- Files: `lib/watchguard/write-guard.ts`, `lib/watchguard/write-client.ts`.
- Tests: `write-guard.test.ts` (7), `write-client.test.ts` (8).
- Verification: mocked transport only; asserts enablement-off and read-credential blocks happen **before** any fetch, one attempt for a 5xx, credential redaction, and no provider call when the token exchange fails.
- Not performed: no live request.

### Phase 5 — Durable dispatch

- Goal: request → approval → dispatch wired end to end.
- Files: `lib/epdr/execution-store.ts`, `lib/epdr/execution-jobs.ts`, `actions/epdr-executions.ts`, `actions/epdr-write-settings.ts`, `lib/epdr/jobs.ts`, `lib/epdr/worker-pass.ts`.
- Verification: `jobs.test.ts` (28) and `worker-pass.test.ts` (4) green; typecheck clean.
- Not performed: database integration and concurrency verification — no isolated database was available. Recorded as blocked (see below).

### Phase 6 — Observation and reconciliation

- Goal: resolve ambiguity by reading provider state, never by re-sending.
- Files: `lib/epdr/execution-reconcile.ts`, `lib/epdr/execution-jobs.ts` (`runProviderObservePass`).
- Tests: `execution-reconcile.test.ts` (8), `execution-dispatch.test.ts` (13).
- Deviation recorded: ThreatSync action-status read and reboot/configuration completion have no re-verified read path in this release, so those observations return `unreadable` → `needs_review` instead of claiming completion.

### Phase 7 — UI and translations

- Goal: an operator can request, approve, reject and inspect without any implicit send.
- Files: `components/admin/epdr/execution-center.tsx`, `app/[locale]/(dashboard)/admin/epdr/approvals/page.tsx`, `messages/en.json`, `messages/id.json`.
- Verification: translation parity — 913 keys in EN and ID, zero keys present on only one side; the message diff is 128 added lines per file with no reformatting.
- Not performed: **Authenticated visual verification was not performed.** No valid local operator session was available.

### Phase 8 — Final verification (pre-remediation)

| Check | Result |
|---|---|
| `npm run test` | pass — 236 files, 2181 passed, 1 skipped (+9 files, +112 tests vs baseline) |
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | pass — 0 errors; 114 pre-existing warnings and **2 new** unused-symbol warnings (`actions/epdr-executions.ts`, `lib/epdr/execution-jobs.ts`) |
| `npm run build` | pass (exit 0), output inspected |
| `git diff --check` | exit 0; only CRLF conversion warnings |
| Translation key set parity | 913 / 913 keys before this audit; usage-level gaps found (`Epdr.action.*` for three ThreatSync actions) |
| Read-only guard unchanged | `lib/watchguard/guard.ts` and `guard.test.ts` not modified |
| Secret pattern scan | 46 changed/new text files: one candidate in a synthetic test fixture only; not a history-wide guarantee |
| Coverage of new glue | 0/108 functions and 0/604 branches in `epdr-executions.ts`, `epdr-write-settings.ts`, `execution-center.tsx`, `execution-jobs.ts`, `execution-store.ts` |

An independent audit then found that the pipeline was structurally connected but several safety
gates were not enforced at the real send path. Phase 9 records the remediation.

### Phase 9 — Audit remediation

Safety fixes:

1. **Exact-target immutability.** The shared builder `lib/epdr/execution-snapshot.ts` now derives
   the snapshot from current state for request, approval and dispatch. The policy compares the
   rebuilt hash at both `approve` and `dispatch`; the worker no longer compares the frozen snapshot
   with itself. A re-bound device, entity or provider incident id blocks the request.
2. **Actor re-authorization.** Dispatch/approval resolve the requester and approver with
   `isActiveSiteAdmin`; a revoked requester or demoted approver cannot send. Worker no longer
   hardcodes `true`.
3. **Rate limit and cooldown.** `countRecentDispatches` counts real send attempts and
   `hasRecentDispatch` enforces a 10-minute per endpoint+action cooldown at approval and dispatch.
4. **Automation pause** is part of the policy input and checked at all three stages.
5. **Attempt ledger.** `epdr_actions.attempt` is a single monotonic counter incremented by both
   dispatch and observation claims; ledger inserts are no longer `ON CONFLICT DO NOTHING`.
   `recoverStaleDispatchLeases` marks the matching attempt `ambiguous`.
6. **Ambiguous outcomes.** Zero matches for an `outcome_unknown` request keep it
   `outcome_unknown` (never promoted to `in_progress`). Exhausted observation budgets move to
   `needs_review`; deadlines are enforced. Observation is scoped to the same connection and
   account revision, and keeps running for disabled connections.
7. **Scan correlation.** Exact marker token (`matchesScanTaskMarker`), recorded `task_id`
   preferred, no guessed task type, every job status aggregated, no result-page/clean claim.
8. **Isolation.** Only explicitly recognized state values count; unknown states are unreadable.
9. **ThreatSync.** Observation is explicitly unsupported and routes to `needs_review` on the first
   pass instead of looping; the missing target-ingestion writer is documented, never invented.
10. **Response hygiene.** Persisted provider responses use a receipt-key allowlist so echoed
    tokens/passwords are dropped. `processed_device_ids` must include the approved device.
11. **Token failure** is a definite rejection (no provider request was made), not `outcome_unknown`.
12. **Scan scope 2** is rejected because selected-item parameters are not implemented.
13. **Temporary send blocks** (cooldown, rate cap, pause, kill switch) keep the approved request
    queued for a later pass instead of pushing it to manual review.
14. **Account drift during observation** moves the request to `needs_review` before any read is
    attempted with current credentials.

Workflow and copy fixes:

- Approval now requires opening the request, reviewing the frozen target/parameters/revisions, and
  ticking a separate confirmation; there is no one-click list approval.
- The StrictMode mount-ref bug is fixed and covered by a component test.
- Parameter changes reset the request confirmation; the list polls for status updates.
- Global action ceiling is editable (superadmin) and the three missing action labels exist.
- Provider write enablement and every lifecycle step write an `EPDR_EXECUTION` audit entry.
- Copy that claimed "nothing is ever sent" or that every action is reversible was corrected in EN
  and ID; the runbook now separates read-only monitoring from gated writes.

Tests added: `components/admin/epdr/execution-center.test.tsx` (5 cases: no mutation on mount,
inspect-before-approve, explicit approval confirmation, StrictMode replay, confirmation reset),
plus new policy cases (missing/expired/stale/changed approval), dispatch cases (allowlisted
response, approved-device receipt, exact marker, job aggregation), and isolation/threat-status
cases.

## Verification of this phase

| Check | Result |
|---|---|
| `npm run test` | pass — 237 files, 2195 passed, 1 skipped (+1 file, +14 tests vs baseline) |
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` | pass (exit 0) — 0 errors, 114 pre-existing warnings, none in the new execution files |
| `npm run build` | pass (exit 0), output inspected |
| `npm run test:epdr:postgres` | pass — 27/27 checks on disposable PostgreSQL (migration chain unchanged) |
| `git diff --check` | exit 0; only CRLF conversion warnings |

Test-only flake fixed separately: `lib/siem/receiver.test.ts` allocated a TCP port and reused it for
UDP, which intermittently hit a Windows excluded-port range (`bind EACCES`). It now allocates a UDP
port on loopback; three consecutive runs passed.

Remaining limits: `actions/epdr-executions.ts` and `lib/epdr/execution-jobs.ts` still have no
DB-backed test; concurrency, claim races and the 0084-specific constraints are verified by review
only. ThreatSync completion is manual review. No live provider request was made.

## Blocked / not verified

1. **Migration application.** `0084` was applied only to a disposable `postgres:15-alpine`
   container (27/27 checks, exit 0). It has not been applied to any real database.
2. **Authenticated browser verification.** Not performed.
3. **ThreatSync completion observation.** Not implemented. Those requests move to `needs_review`
   on the first observation, and no ingestion writer exists for `epdr_provider_incident_targets`.
4. **Execution-window and isolation message parameters.** Field names were not re-verified, so they
   are not sent in this release.
5. **Credential rotation.** The RW/RO credentials pasted into the conversation must be rotated
   before activation. This document and the code contain no credential values.

# Hardening continuation — 2026-11-17 (second execution pass)

## Gate results for this pass

| Check | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm run test` | pass — 242 files, 2238 passed, 1 skipped (243 added tests vs the 2195 baseline) |
| `npm run lint` | pass — 0 errors, 114 pre-existing warnings, none in the new execution/provider-target files |
| `npm run build` | pass (exit 0), "Compiled successfully" |
| `npm run test:epdr:postgres` | pass — 41/41 checks on disposable `postgres:15-alpine` (Docker), exit 0 |
| `npm run test:epdr:postgres:integration` | pass — 7/7 checks on disposable `postgres:15-alpine` (Docker), exit 0 |
| `git diff --check` | exit 0; only CRLF conversion warnings |
| EN/ID message parity | 0 mismatched keys both directions |

New verification entries: `scripts/test:epdr:postgres:integration` (`scripts/epdr-postgres-integration.ts`,
`test:epdr:postgres:integration` in package.json) plus a shared `scripts/lib/isolated-postgres.ts`; both scripts
run on a disposable container, refuse `DATABASE_URL`/`DB_HOST`, and always remove the container. Both are wired
into `deploy.yml` as a required `epdr-postgres-verification` job gating `deploy`.

## Hardening phase 1 — atomic reservation and per-site limits

- Migration `drizzle/0085_epdr_provider_writes_hardening.sql` (journal idx 85, hand-written): per-site
  `execution_cooldown_minutes` (default 10, CHECK 0..1440), nullable `max_actions_per_hour` (CHECK 1..10000,
  NULL = follow global), retention day columns with CHECKs, `epdr_attempt_events` append-only table with an
  UPDATE/DELETE trigger, `epdr_worker_heartbeats(worker_id PK, ...)`, `epdr_attempts` reservation fact columns
  (connection_id/endpoint_id/action_type + backfill), provider incident `account_revision` identity with the
  renamed unique index, target confirmation columns, `watchguard_connections.last_provider_sync_*`, and the
  claim/cooldown/queue/phase indexes.
- `db/schema.ts` patched to mirror all of the above.
- `lib/epdr/execution-store.ts`: `effectiveExecutionLimits` (`LEAST(site, global)`), `loadEffectiveExecutionLimits`
  (tx-capable executor parameter), connection-scoped `countRecentDispatches`/`hasRecentDispatch` with
  exclude-self parameters; the hardcoded cooldown constant is gone. `loadProviderIncidentTargets` now accepts
  only operator-confirmed targets whose incident matches the connection's current account revision.
- `lib/epdr/execution-jobs.ts` claim refactor: one transaction locks the connection row (`FOR UPDATE` per-site
  mutex), reads `LEAST(site, global)` limits, counts committed dispatch attempts, claims with a cooldown
  anti-join + `FOR UPDATE SKIP LOCKED`, commits the attempt row and its `claimed` event; HTTP stays outside the
  transaction. Post-claim revalidation aborts to `queued` (transient) or `needs_review` (hard) with the attempt
  marked `aborted` and `dispatched_at` cleared. New `expireExpiredApprovals` sweep cancels lapsed approvals with
  `review_reason='approval_expired'`. Observation candidates are claimed `FOR UPDATE SKIP LOCKED` inside their
  transaction; observation finalize writes `observed` events.
- Attempt lifecycle events `claimed / sent / accepted / ambiguous / aborted / observed` are written to
  `epdr_attempt_events`.
- Per-site cap (validated ≤ global) and cooldown fields added to `actions/epdr-write-settings.ts`, the
  `Epdr.execution` options (`limits`), and the execution-center settings UI; EN/ID copy added.
- Tests: `lib/epdr/execution-jobs.test.ts` (6 — claim SQL contract: mutex/LEAST/anti-join/SKIP LOCKED, claim
  + attempt + event commit, transient vs hard abort, gates/cap short-circuits; expired-approval sweep),
  `lib/epdr/execution-store.test.ts` (8 — LEAST semantics, connection-scoped helpers, 0085 schema/migration
  parity).

## Hardening phase 2 — ThreatSync ingestion, confirmation, observation

- `lib/epdr/provider-targets.ts` (pure): drafts incidents/targets from `ThreatSyncIncidentRecord`; `entity_id`
  only from explicit provider fields (record key or `entity_id`/`entityId`), `providerDeviceId` only from
  explicit device fields, never derived from each other; endpoint suggestion requires an exact single match.
- `lib/epdr/jobs.ts`: registered the `provider_sync` job — read-only incident iteration, upserts keyed on
  `(connection_id, account_revision, ts_incident_id)`, never sets `review_state`, never overwrites a confirmed
  endpoint with NULL, and updates `last_provider_sync_at` only after a completed iteration on an unchanged
  revision. `runDetectionsJob` no longer compares ThreatSync entity ids with `wg_device_id`: endpoint
  resolution goes exclusively through operator-confirmed targets (`resolveConfirmedTargetEndpoint`); historical
  detections are surfaced as a mislink report, never rewritten.
- `actions/epdr-provider-targets.ts`: `getEpdrProviderTargets` (unreviewed candidates + suggested endpoint +
  mislink report, bounded), `confirmEpdrProviderTarget` (row lock, same-site/connection/revision endpoint
  verification, audit `EPDR_EXECUTION`/`provider_target`), `rejectEpdrProviderTarget` (reason, audit).
  `lib/audit.ts` gains the `provider_target` entity.
- `components/admin/epdr/provider-targets.tsx` mounted on `/admin/epdr/threats`; EN/ID copy under
  `Epdr.providerTargets`.
- `lib/watchguard/client.ts`: account-level `getAction(actionId)` and `listIncidentActions(incidentId)` (both
  routes already allowlisted); tests cover both documented envelopes and shape rejection.
- `observeThreatSyncAction` implemented: command actions read `getAction(provider_ref)` and only
  `inProgress`/`performed` are recognized; `ts_incident_status` compares `getIncident(...).status` with the
  frozen requested status; everything else is unreadable. The "ThreatSync is never retried" special case is
  removed — unreadable now follows the same bounded retry as other reads. `interpretIncidentStatusMatch` added
  to `execution-reconcile.ts` with strict tests.

## Hardening phase 3 — monitoring, heartbeat, health, retention

- `scripts/watchguard-worker.ts` upserts a per-process heartbeat after every pass (ran/failed, best-effort).
- `lib/metrics.ts` + `/api/metrics`: `epdr` block (queued, pendingApproval, expiredApproval, staleLease,
  observeDue, overdue, needsReview, outcomeUnknown, orphanAttempts, workers, workerLatestPassAt, retention
  lastRunAt); null-safe when EPDR tables are missing, never throws.
- `actions/epdr-execution-health.ts` (site admin, `assertReadSyncActor` in the same transaction) returns
  counters plus the 10 oldest non-terminal requests without payloads; `components/admin/epdr/execution-health.tsx`
  renders it on `/admin/epdr/activity` with a 20-second refresh.
- `scripts/healthcheck-watchguard.ts` (exit 1 on stale heartbeat or stuck thresholds, env-tunable), wired as
  the `watchguard-worker` compose healthcheck; `npm run watchguard:healthcheck`.
- Retention: `lib/epdr/retention.ts` (pure windows + batched `FOR UPDATE SKIP LOCKED` passes; deletes only
  terminal-action attempts, redacts `result`/attempt `response`; actions/snapshots/approvals permanent),
  `scripts/epdr-retention-worker.ts`, `/api/cron/epdr-retention` (CRON_SECRET), `epdr:retention` scripts,
  `epdr-retention` compose service, and per-site retention fields in `actions/epdr-settings.ts` + the settings
  page (attempt ≤ result window enforced in the schema refine).

## Local review T01–T04

- T01: `lib/epdr/local-capabilities.ts` (client-safe capability contract, `localStepCapability` per step),
  dead `incidentPolicy` field removed from the evidence type in favor of explicit capability fields; catalog
  step labels are per-step, not a blanket "inert"; runner shows each step's engine reason.
- T02: PlaybookVersionForm extracted and rendered inline by the runner (no-compatible-version case) and the
  history panel; onSaved refreshes choices and selects the new version; shared classifier
  lib/epdr/playbook-version.ts (invalid_configuration / unknown_template / definition_changed) used by the
  options action and shared with the engine vocabulary.
- T03: getEpdrLocalPlaybookOptions({detectionId, versionId}) computes read-only pre-create eligibility from
  the same extracted signal builder the start path uses; the runner marks the current of 4 stages with
  aria-current, shows the eligibility panel (blocker, policy, endpoint facts) before create, guards stale
  selections after refresh, and maps version_definition_changed / detection_outside_configuration /
  detection_outside_template to actionable copy instead of a generic failure.
- T04: EN/ID pass for every new key; stale copy corrected (approvalsV2.approvedNote, playbooksV2.locked/safety,
  runner hint, noVersions); IncidentHandoff distinguishes new vs existing linked incidents and states the
  boundary (creates/links a DC Incident; does not change endpoint or provider).
- Tests: lib/epdr/local-capabilities.test.ts (6), lib/epdr/provider-targets.test.ts (6), updated
  actions/epdr-local-playbooks.test.ts (52), local-playbook-runner.test.tsx (25 incl. eligibility, stage
  semantics, stale-selection guard, inline authoring, error mapping), playbook-history.test.tsx (15),
  client tests (33), reconcile/observation cases.

## Real bug found by the integration script

Drizzle's raw db.execute returns timestamptz as a string; revalidateForDispatch called
approval_expires_at.getTime() directly, which would have crashed every real (non-mocked) dispatch claim.
Fixed with a defensive new Date(value) parse that accepts both shapes; the integration script is the
regression guard for it.

## Blocked / not verified (unchanged where noted)

1. Migration 0085 applied only to disposable containers (41/41 + 7/7). Not applied to any real database.
2. **Authenticated visual verification was not performed.**
3. No live provider request, credential rotation, production enablement, commit, or push was performed.
4. ThreatSync stays unusable until an operator confirms targets (by design); the mislink report is a review
   surface, not a rewrite.
5. Closing needs_review remains a single-admin decision (residual risk recorded in the runbook).
