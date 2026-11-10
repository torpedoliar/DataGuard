# Shared integration contracts

Authoritative cross-ticket definitions. Read before any ticket. Ticket SQL is illustrative; implement these constraints too. Defaults below are engineering recommendations, editable through authorized UI within validated global ceilings.

## C0. Binding read-only restriction

[READ_ONLY_SAFEGUARD.md](READ_ONLY_SAFEGUARD.md) supersedes all live provider-write behavior described below. The user now prohibits any WatchGuard server change. Only allowlisted reads and exact OAuth authentication POST may use the real adapter; every other mutation is blocked before network, without a UI/config unlock. C1–C9 write workflows are design/mock-only until separately authorized and reviewed. Implement guard/tests before any real connector integration.

## C1. Identity, tenancy and lifecycle

- One active connection per site and one binding per `(region, account_id)`. All redundant site/connection/endpoint IDs use composite keys/FKs or an equivalent transactionally enforced invariant; checking a form alone is insufficient.
- An endpoint is resolved when its provider `device_id` is validated against that site's current account inventory. Asset link is optional. Server = provider type 3; critical = endpoint criticality OR linked asset criticality. Unknown platform/device type is never automatically dispatched. Unresolved ThreatSync entity remains visible for review, not silently ignored.
- Credentials/API key encrypted; configured booleans and nonsecret labels only leave the server. Strict read, secret clear/rotate controls, redacted errors. Credential change increments `credential_revision` and invalidates token/test cache. Account/region change increments `account_revision`, disables dispatch, requires retest/rebaseline, cancels pending old-account commands and preserves old inventory/evidence. Never move historical endpoint identities to a new account.
- Tokens keyed by region/account/access identity AND credential revision (or nonreversible credential fingerprint). Per-process single-flight; bounded multi-worker auth; never log cache keys containing secrets. All request path IDs encoded; HTTPS fixed host; redirects refused, especially for authenticated requests.
- Disabled connection/site stops new jobs/commands but preserves history. Credentials can be explicitly cleared; active records are soft-deleted. Preserve incident targets with RESTRICT/archive, not cascade deleting evidence or orphaning the target CHECK.
- Policy settings have `revision`; every approved command freezes target, params, rule revision, account revision, evidence generation, requester and approver. A material change invalidates approval; current security settings are always rechecked.

## C2. Two detection paths; identity and recurrence

- **Scored incident**: normalized IOA/Malware/PUP/Virus/Exploit with `7 <= threatScore <= 10`. Score missing/out of range is not treated as 7. Category AV and unknown program require explicit detail evidence, not a guessed mapping.
- **Activity**: event export types 1/2/4 (Malware/PUP/Exploit); no score required. Also ingest 6/18 for category coverage, but an unscored IOA follows review by default. Templates remain distinct by `source` and score-presence policy.
- Event dedup key scopes provider ID by connection, category, device and event timestamp; fallback includes canonical evidence fingerprint. Re-polling an unchanged record creates no new occurrence. Changed ThreatSync occurrence/signal/entity evidence increments `evidence_generation` atomically and resets observation; status-only edits/comments from dc-check do not count as new attacks. When occurrence timing cannot be determined, review instead of replaying.
- One workflow per endpoint + threat episode. Attach only matching threat keys (MD5 or explicit vendor correlation), not any alert on the same host. Unknown keys do not mass-correlate. Persist cross-source links; timestamps alone suggest correlation, not prove identity.
- First import/recovery imports historical evidence without dispatching it. Connection/site `automation_start_at`, backfill lookback and last complete checkpoint prevent scan storms. UI explicit replay of selected historical incidents uses approval. Continue fetching current details for all tracked nonterminal ThreatSync incidents even if creation timestamp falls outside list `duration`.

## C3. Multi-entity provider incidents

T05 adds `epdr_provider_incidents` (unique connection + ThreatSync incident ID, provider status, entities/evidence fingerprint, complete-sync revision) and `epdr_provider_incident_targets` (unique provider incident + entity ID, optional verified endpoint, optional DC incident, classification/review state).

- Preserve the provider incident once; create per-target detection keys `ts:<incidentId>:<entityId>` and one endpoint workflow/DC Incident per validated target. Incident `external_ref` is display metadata, not a unique one-to-one mapping.
- A provider incident may link multiple DC incidents and one DC incident may link multiple provider incidents. Persist links, never rely on a single `ts_incident_id` column for closure.
- Unmatched, non-endpoint or out-of-scope entities stay recorded; require review before closing the whole provider incident. UI shows per-entity scan/progress and the unresolved remainder.
- Provider `closed` can be sent only after all relevant mapped workflows pass verification and all unresolved entities are reviewed. One endpoint's success cannot close the provider incident for another endpoint/site. New entities invalidate the previous close decision.
- Campaign parent is a separate `epdr_campaigns` + member-link table (T08), not an asset-less `incidents` row that violates its target CHECK. Endpoint incidents remain native DC incidents.

## C4. Completeness, freshness and pagination

- Store per-stream/per-category `last_complete_at`, checkpoint, coverage window, completeness/error reason (T03/T05); one connection-wide timestamp is not proof of complete evidence. Partial/failed runs do not advance complete checkpoints or disappearance/removal decisions.
- OpenAPI lists unprefixed `top/skip/count` while inventory was live-tested with `$top/$skip/$count`. Event export **does list** top/skip in complete YAML. Client has per-operation adapters and a compatibility test proving page offsets actually change records. Guard repeated pages, stable ordering/ties, maximum page/time bounds and null totals; failure = incomplete, never empty-clean.
- Event export has a per-response cap; page all supported results. If cursor/offset ignored, mark incomplete and optionally use bounded per-host export after verifying unique hostname targeting; never claim complete from the first 3,000. Read status/results pages fully too. ThreatSync uses cursor + tie-safe bounded traversal, rereads overlapping windows and dedups.
- Automatic dispatch/close requires fresh complete endpoint, protection and relevant detection streams. UI exposes data age/coverage. Pending provider errors block close, not the last known incident's visibility.
- `data` object-versus-array inconsistencies normalize at the client boundary with fixtures; unexpected shape is invalid/incomplete, never zero rows. Unknown enum preserved but never qualifies for automation. `isFinal`, `remediated`, `affected_items` and HTTP 200 alone are not proof of complete remediation.

## C5. Command safety and concurrency

- Modes: `simulate` emits a decision only; it never becomes approval or sends status/comments. `approval` creates a pending request. `automatic` can be downgraded by server/critical/no-auto/unknown-type protection. Hard identity/capability blockers stay blocked. Breaker pause stops automatic dispatch; explicit manual review remains possible within limits. Kill switch blocks all new provider writes, including automated close/status outbox, while reads continue.
- Typed action states: `pending_approval`, `queued`, `dispatching`, `in_progress`, `completed`, `failed`, `cancelled`, `outcome_unknown`, `needs_review`. Types validated with CHECK and Drizzle definitions. Provider numeric scan status and string ThreatSync status are separate columns/fields; do not overload integer storage.
- One active scan per account/endpoint plus durable request links to any episodes it covers (T07 `epdr_action_incident_links`). Partial unique active-command guard + endpoint advisory lock serialize claim/cooldown/rate reservations. Opposing isolation commands serialize. New episode/scan has a new command identity; never reuse provider operation IDs.
- Task name includes unique action UUID/key (not only incident number). Reconciliation adopts only exact action marker, account, recipients, scope and attempt window. Ambiguous/multiple matches -> needs_review. Local dedup cannot guarantee provider exactly-once across network failures; document this honestly.
- Whole write exchange may be ambiguous: network/timeout, 5xx after send, malformed 2xx or crash before persisting ID -> outcome_unknown. GET retries; writes never blindly replay. 401 refresh replay only after definitive authentication rejection and no possible provider acceptance. 429 retries require a durable, explicit decision, not client-loop POST retries.
- An automatic action becoming approval-required returns to `pending_approval`; approval is not an unconditional bypass. Distinct approver must still have active site-admin rights at dispatch. Takeover/hold persists and blocks queued automatic commands and close.
- Task deadline uses provider duration format `d.hh:mm:ss` (24h = `1.00:00:00`), tested against schema; do not emit invalid `24:00:00` by guess. Configured scan exclusions and detection options appear in immutable approval preview; no silent antivirus policy bypass.
- Durable attempt records and outbox rows accompany state transitions in the same transaction. Audit failure is visible/recoverable. One failure must not erase which action may have been sent.

## C6. Resolution evidence, approval and provider sync

- `completed` scan records execution success; `scan_evidence_state` remains pending/valid/incomplete separately. Store provider `start_time`, `finish_time`, recipient, job, complete status/results, detection coverage, evidence generation and closure policy revision. `affected_items` semantics must be contract-tested; null/missing is not zero, affected count is not itself a guarantee of disinfection.
- Require an actual successful scan starting AFTER the latest actionable occurrence (not merely task dispatch time), complete recipient results, sufficient clean evidence, no unresolved recommended remediation, fresh protection, full relevant detection coverage through observation, and no material incident/entity change. Unknown -> review.
- Older failed/dirty attempts stay history; latest qualifying verified scan per endpoint can supersede them, rather than requiring every historical attempt to succeed. One bounded rescan is a UI-configurable proposal, not blind repetition.
- DC states stay Open / In Progress / Resolved / Verified. `In Progress` only after accepted command or explicit human start, not while dispatch pending. Workflow adds `verifying`, `awaiting_close_approval`, `ready_for_manual_close`; declare these in a shared enum.
- T08 adds durable `epdr_close_requests` with frozen decision/evidence generation, requester/approver, expiry and conditional state transitions; approval re-verifies evidence. Human verification (`Verified`) remains manual. Neither Hold nor mixed/manual Incident can be bypassed by health or threat auto-close.
- Execution mode and closure mode are independent UI settings. Default closure = review for Critical/IOA/Exploit/server/critical. Global permitted closure categories/scores form the ceiling. Explicit second-admin policy activation may allow other categories only where evidence genuinely suffices; IOA/Exploit clean scan alone never suffices. UI explains effective policy overrides.
- `epdr_provider_sync_outbox` (T07) owns typed status/comment intentions, dedup key, account revision, evidence generation, retry/unknown outcome and error. Read/comment/close sync never re-dispatches an endpoint command. Re-read current provider incident/evidence before applying stale outbox entries; drop superseded read/close entries. A retried comment reconciles by marker to prevent duplicates. No assumption provider supports CAS.

## C7. Health-specific limits

- Desired automatic repair protection then repair agent is retained as **blocked capability** pending an official supported API. Manual Console work is an explicit fallback, not an implementation of repair API. No hidden/private Console endpoints, browser automation or uninstall/reinstall workaround.
- Managed protection enum has no Installing. Unmanaged `/unmanageddevices.status=2` means Installing for that inventory; it does not prove the same population as the screenshot. Store in `epdr_unmanaged_devices`, show separate counters; do not add them to managed totals or equate an unknown enum to Installing.
- Compare module statuses and profile/OS support; disabled may be intentional policy. Only expected enabled modules constitute an error. Stable health requires fresh supported module readings; unknown/license/offline != healthy.
- Never infer reboot need from `reinstall_*_requested`. Only explicit reboot flags plus a UI-enabled approved reboot policy may propose reboot. Flag clearing alone is not proof a reboot executed; track accepted-unverified, baseline/last contact and confirmation evidence or require manual confirmation.
- Installing grace expiration creates diagnosis/review, not fabricated repair. Repair-agent escalation records protection-repair attempt/confirmation first unless agent health makes that diagnosis impossible (explicit reason).
- Health cases cannot close a threat Incident. Same-target manual/mixed incidents stay manual. Server/critical immediate notifications and health closure policies are enforced like C6.

## C8. UI configuration ownership (no manual SQL/env for business rules)

Every row is validated server-side, audited with revision, previewed with effective overrides, available in en/id. All enums/ceilings reject invalid values rather than silently clamp. Low-level code safety ceilings are not editable secrets/business configuration.

| Owner | UI settings / controls | Ticket |
|---|---|---|
| Superadmin global | Kill switch; action allowlist; per-site maximum actions/hour; minimum simulation days (default7); allowed auto-close categories/scores; maximum approval/exclusion validity; audit/evidence retention minimum | T02, T06, T08 |
| Superadmin per-site connection | Account/region, encrypted API key RO/RW credentials, enabled; test disabled draft without enabling; explicit clear/rotate; account revision confirmation; endpoint/detection/task poll intervals; historical lookback/activation boundary | T02–T03 |
| Site admin detection | Source toggles, five normalized categories; scored min/max(default7/10); score-absence mode; activity 1/2/4; correlation/reopen windows; PIC/assignment; per-severity SLA/dueDate | T05 |
| Site admin rule | Enabled/version/priority, source/score-presence/categories/range/type/group/endpoint allowlist, full-scan options scope/exclusions/expiry, simulate/approval/automatic; independent close mode, observation, rescan limit, cooldown; request/confirm mode activation | T06–T08 |
| Site admin protection | Grace, installing timeout, stage waits, expected modules and standard profile per OS/type, reboot mode/countdown/maintenance window, repair manual confirmation, stable-health/closure policy; unsupported labels | T09 |
| Site admin safeguards | Per-site hourly cap <= global, breaker count/window/outbreak threshold, pause/resume confirmation, offline/stale thresholds, approval expiry, no-auto/critical endpoint flags, expiring exclusions; read-only global ceiling | T03, T06–T09 |
| Site admin alerts | Existing per-site Telegram destinations, event toggles for new detection/approval/failure/close/reopen/breaker/health, quiet window for noncritical summaries; critical breaker/failure warning still visible | T05, T07, T11 |
| Site admin advanced | Isolation message/exceptions supported by schema, approval-only actions, exact provenance targets, unblock/unsolate reversal, account-wide IP warning; standard profile selection | T09–T10 |
| Authorized operator | Hold/release/takeover, owner assignment, review unmapped entities/backfill, action/close approve-reject, cancel unsent request, explicit replay; each requires current site role | T05, T07–T10 |

Site staff gets read-only Endpoint Security and Threats navigation, not the rest of admin Security navigation. Secrets remain superadmin-only. Global deployment bootstrap (DB URL, encryption/session secrets, worker service) is documented infrastructure setup; it is not moved to a public UI.

## C9. Completion evidence

Each ticket tests its boundaries with injected provider/clock and actual isolated DB constraints/race tests where applicable. Handoff includes changed files, forward migration validation, full-suite results, blocked live validations, no credential material. No commits/push, live schema application, endpoint scan/reboot or production rule activation without explicit authorization. Shell/doc-only changes do not claim app tests passed. T11 owns operator runbook, UI/config coverage and release checklist.
