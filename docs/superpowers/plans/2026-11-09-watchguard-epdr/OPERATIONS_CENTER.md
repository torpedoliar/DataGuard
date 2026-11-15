# EPDR Operations Center — delivery ledger

This supplements the approved Operations Center plan, not the binding
READ_ONLY_SAFEGUARD.md. No provider write permission is granted by this document.
No live requests, worker execution, deployment, or existing database migration
are part of implementation validation. Do not use credentials from conversation.

## Delivery boundaries

1. Correctness/site authorization and fail-closed eligibility.
2. Dashboard/Devices with complete pagination, filters and local management.
3. Twelve template playbooks and evidence-based simulation preview.
4. Durable read-sync requests and worker integration (implemented; deployment
   worker proof remains; mock long-read renewal/lost-lease regression tests pass).
5. Persisted playbook versions/sample evidence, explicit local review runs and
   steps, local Incident/PIC handoff, assignee-only in-app notifications with
   overdue scheduling, quiet windows, opt-in admin escalation and a daily
   per-recipient in-app digest (implemented locally). External channels and
   tier-specific automation remain pending.
6. Durable local approvals with second-admin decisions (implemented, mock-local:
   approval never dispatches). Provider reconciliation and mock provider E2E
   remain pending; real writes stay blocked.
7. Per-action public API capability review (see CAPABILITY_REVIEW.md; ThreatSync
   documented, Endpoint Security operations unverified) and separately authorized
   pilot (pending; real writes remain blocked).

## Policy requirements

Sources and categories are separate. Supported threat category filters are IOA,
Malware, PUP, Virus and Exploit. Missing scores use a distinct event policy, not
an invented score. Suggested response tiers are policy proposals, not official
provider severity: 1–3 record/digest; 4–6 local correlation/persistent-case review;
7–8 local Incident/PIC with future eligible workstation scan; 9–10 local priority
escalation with disruptive actions requiring approval. Human-edited Incident
priority never grants provider execution.

Unresolved identity, stale/incomplete evidence, unsupported action and account
revision mismatch are hard blocks, not approvable exceptions. Server/critical/
no-auto controls are additional restrictions, never transport unlocks. Simulation
must not enqueue sync, create Incidents, send notifications or mutate provider.

Local Incident status, provider observation and action execution remain distinct.
A completed scan does not prove exploit remediation or IOA clearance. No automatic
closure from an empty/truncated event list. All templates start in simulation.

## Implemented slices and remaining limits

- Eligibility always resolves to blocked or simulation under the existing transport
  lock. Caller-supplied role/site cannot elevate the shared security context.
- Twelve catalog templates and explicit, bounded stored-data previews are available.
  Source-specific read attempts are now persisted by migration 0080, distinguishing
  completed/partial/failed reads and captured account, credential and settings
  revisions. Preview uses the latest attempt, never only the latest success;
  disabled/stale/changed settings invalidate evidence. EventExport completion
  requires all configured required event types; request scope is not arbitrary
  historical coverage. Health/local templates are previewed separately from
  stored endpoint, connection-test and local Incident evidence
  (`lib/epdr/operational-playbooks.ts`), with unknown/stale/identity evidence
  blocked and no claim that a healthy reading is remediation or closure.
  Migration 0073 adds app-authored immutable simulation versions
  and explicitly recorded bounded sample evidence with inert step definitions.
  A changed catalog definition requires a new version. Recording a simulation
  sample has no Incident, notification, sync or provider side effects. Simulation
  samples are distinct from the explicit resumable local review executor described
  below; neither activates automated provider execution. Local run history and
  saved simulation versions/runs are server-paginated (50 per page, clamped
  offsets) with previous/next controls.
  Migrations 0073-0083 are applied and constraint-checked against a disposable
  isolated PostgreSQL 15 container via `npm run test:epdr:postgres`; no existing
  database was touched.
- Device table action validates filters and returns 50-row database pages with
  stable sorting, a matching total and identical site-scoped predicates. The
  overview/map still loads the full fleet snapshot; this is not a fully aggregated
  large-fleet query architecture. Device type enum mapping still needs official
  capability/schema verification; it must not authorize provider execution.
- Read-sync schema and worker integration are development changes, not evidence
  that a deployed worker is running. Migrations are verified only in an isolated
  disposable database. Queued means locally recorded, not provider acceptance.
  Cancellation invalidates local publication permission; it does not promise
  cancellation of an already-started provider read. The ten-minute claim lease
  renews every minute with binding/actor checks. Renewal failure invalidates the
  callback's publication fence and suppresses a successful terminal update.
  Mock tests cover long reads, revoked leases and database renewal failure;
  real multi-worker renewal races remain unverified.

- Explicit admin handoff from a stored detection to a local Incident is separate
  from simulation. It requires a current enabled connection, same-site live endpoint,
  active actor, and current-site assignee/PIC selection. Existing linked Incidents
  are returned without reassignment/reopening. New Incidents have automation hold,
  a local review reason, due date and creation history. PIC is recorded as handoff
  responsibility, not an assignee or notification recipient; no emails/Telegram
  are sent. Options are bounded to 200 users/groups. Migrations 0074/0078 are
  applied in the isolated verification, including the `epdr_manual` source.
  Ingestion attachment now uses binding/detection locks and transactional
  correlation to avoid overwriting a manual link for the same detection.
  This is per-detection idempotency, not cross-detection threat-episode dedup.

## Required later delivery

- PostgreSQL-backed concurrency validation of the implemented DB-time cooldown,
  dedup/claims and per-publication fencing beyond the isolated constraint and
  SKIP LOCKED checks. Heartbeat renewal is implemented and mock-tested;
  a cancelled/expired read can continue network reads but cannot publish through
  its old lease. Whole-sync snapshot atomicity and scheduled advisory-session-loss
  fencing are not delivered. Partial manual reads have an explicit partial state.
- Cross-detection/episode Incident dedup, automatic asset-to-PIC mapping, editable
  handoff routing/history view. Manual selection is implemented; it does not
  modify device PIC bindings or existing Incident routing. A local in-app
  notification outbox (migration 0076) delivers assignee-only notices with
  dedup/retry/lease/revocation rechecks and opt-in overdue scheduling; no email,
  Telegram or webhook channel is implemented. Successful handoff/constraint
  behavior is verified in the isolated PostgreSQL check.
- Optimistic version publication, lifecycle/archival controls and cross-run
  scheduling remain open; local run and simulation history are server-paginated.
  Explicit local review runs are now durable
  (migration 0075): immutable evidence, idempotency per version+detection,
  ordered per-step outcomes, CAS lease/generation fencing and operator resume.
  Incident/handoff steps remain `requires_operator`; notification/provider steps
  are permanently suppressed. "Finished" means local outcomes were recorded, not
  remediation. Provider-approval/provider-auto modes remain unimplemented/locked.
- Local approvals are now durable (migration 0082): an admin can request a
  decision for a `scan`/`isolate` intention only when the saved local review
  proposed it (the request is raised from the local review panel), with a 24-hour
  expiry, immutable snapshot, current identity/revision
  rechecks and a different-admin decision requirement. Approving records
  `blocked_read_only` in the decision; no queued provider work, dispatcher or
  transport call exists. Pending/expired rows are listed on the Approvals page.
  This is a local decision ledger, not a live provider approval queue; rule-mode
  "automatic" activation still fails closed.
- Overdue escalation is opt-in per site and targets currently active site admins
  (never guessed PIC recipients), with the same quiet-window, hold and revocation
  rechecks as assignee notices. The fleet overview now aggregates counts and filter
  options in SQL and sends only a bounded map sample (300) instead of the whole
  inventory; table rows remain server-paginated.
- Unknown post-send outcomes reconciled before retry. Provider accepted/running/
  completed/remediated states must be read, not fabricated.
- Endpoint Security scan/reboot/configuration operations still need a verified
  public operation/schema review. ThreatSync public commands are documented in
  CAPABILITY_REVIEW.md but remain blocked_read_only. Repair stays unsupported. No
  arbitrary commands or private APIs.
- Remaining unverified: real deployment concurrency (lease expiry during long
  reads), caller-level attachment-recovery after a crash, approval races,
  unknown-outcome reconciliation and browser interaction checks. Isolated DB
  covers migration constraints, queue dedup/SKIP LOCKED claim, handoff uniqueness,
  playbook evidence immutability and notification scheduling/dedup.
- Desktop/mobile browser verification with synthetic local data; full tests,
  lint, typecheck and build where no live service is required. Report skipped
  validation rather than claiming completion.

## Audit follow-up (current working tree)

- Fixed local-review start to require current detection revision and revision-matched
  endpoint identity, before looking up an existing run or capturing evidence.
- Preview reads now join the enabled current binding and require matching endpoint
  revision. Historical observations are not relabelled as current-account samples.
- Ingestion now verifies resolved credential/account revisions, transactionally
  fences accepted/ignored detection inserts against rebinds, and resolves endpoint
  identity using the same site/account revision. Raw provider errors are not logged.
- Correlation now matches an existing open/closed workflow on the same endpoint and
  site by exact threat key or by the same full 32-hex MD5 suffix, so one file hash
  reported under a different category/source key attaches to a single episode.
  Non-hash names never use the LIKE fallback, preventing wildcard injection or
  name-only mass correlation.
- Migration 0079 makes detection uniqueness revision-aware: rereads create separate
  evidence without overwriting historical detections. Isolated verification caught
  an incorrect index-drop assumption; the migration now drops the actual SQL
  unique constraint before creating the revised index. Endpoint uniqueness and
  the worker upsert target also include revision, preserving historical host IDs
  and preventing cross-account inheritance of local asset assignments.
- Added heartbeat tests for long reads, renewal rejection and database failure;
  corrected obsolete no-heartbeat/no-resumable-executor statements above.
- Disposable PostgreSQL cleanup now uses the ID returned by successful creation,
  never an unowned name after a failed creation; cleanup failures fail validation.
- Latest integrated validation: full Vitest 227 files / 2035 passed / 1 skipped;
  ESLint 0 errors / 114 warnings; typecheck passed; production build passed;
  isolated PostgreSQL 27/27 checks passed through migration 0083, including the
  quiet-window, local-approval, escalation, digest-policy and digest-target
  constraints. Migration 0083 also replaces the original 0076 notification `kind`
  CHECK so `sla_escalation` and `digest` are accepted; apply 0083 before enabling
  either feature. One earlier concurrent validation repeat hit a SIEM socket bind EACCES; retain this environment-sensitive
  test caveat rather than attributing it to EPDR. Database checks use synthetic
  fixtures/SQL and are not full server-action integration tests.
- Threat table now separates request loading from returned page numbers, exposes
  retry for failed queries, accepts server-clamped pages, cancels stale responses,
  refreshes default data or the current filtered query on refreshed server props,
  and reports invalid input as not busy. Ten mocked interaction regressions pass.
- Further integrated repairs: fleet reads require an enabled configured binding
  and explicit connection/revision scope; inbox/count/mark-read share current
  Incident visibility checks with locked current membership/role validation.
- Queue/notification pass failures no longer starve scheduled reads; one-shot
  execution reports auxiliary failures. Local run list and detail refresh together
  after resume; failed inspection clears stale detail. Activity includes local runs,
  notification outbox and truthful partial-read status.
- Source evidence is wired into preview and explicit local review. Settings changes
  invalidate captured completeness. Pure local tier recommendations are captured
  as evidence, not represented as delivered automation.
- Pure approval snapshots now validate second-admin separation, target/parameters,
  account/credential/rule/evidence revisions, expiry and current security gates.
  Mock flow tests cover unknown outcomes and reconciliation without blind resend;
  the real client blocks the same approved payload before network I/O. This is a
  durable local decision ledger, not a live provider approval queue.
- Local notification policy now supports an opt-in UTC quiet window (migration
  0081, nullable pair, end hour exclusive, cross-midnight supported). Delivery
  rechecks the locked current policy and the database clock before publishing and
  requeues without spending an attempt; invalid/paired values are rejected
  server-side. Overdue notices are scheduled at the due date and postponed when a
  deadline is extended. Migration 0083 adds an opt-in daily in-app digest: one
  summary per recipient per UTC day at/after the configured hour, deduplicated by
  recipient+day, cancelled when no unread notices remain, and subject to the same
  quiet window and membership rechecks. Digest rows have no Incident target;
  inbox/mark-read treat them as recipient-owned. The inbox also exposes a read-only
  grouping of current unread notices. No external channel is implemented.
- Green tests do not prove every approved feature is delivered. Correlation of
  name-only signatures that share neither a key nor an MD5, automated tier
  execution beyond explicit review/approval, and real desktop/mobile browser
  verification remain open. All UI paths are covered by mocked interaction tests
  rather than a browser. These remaining local/mock omissions are not justified
  by the provider read-only lock.

The capability inventory in lib/epdr/capabilities.ts is a design inventory, not
proof that every operation is supported or enabled. Initial UI previews do not
constitute persisted playbook execution or an active automation engine.
