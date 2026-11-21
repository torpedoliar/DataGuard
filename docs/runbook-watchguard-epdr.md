# WatchGuard EPDR — Operator Runbook

Status: **read-only ingestion plus opt-in, gated provider writes**. Inventory and
evidence are always read through the read-only transport
(`WATCHGUARD_READ_ONLY_LOCK = true`). Provider writes exist only through the
separate execution pipeline documented in §11: both enablement gates default off,
a site administrator must approve an immutable target snapshot (the requester may approve),
with approval recorded in the activity log, and the
worker re-validates every gate immediately before one single send. There is no
arbitrary HTTP path, no bulk execution and no automatic (approval-free) write.

## 1. Entry routes

| Route | Page | Access |
|---|---|---|
| `/admin/settings` (WatchGuard card) | Per-site connection + superadmin global controls | superadmin |
| `/admin/epdr` | **Summary** — current-account metrics, independent source freshness, and prioritized daily work | site staff (read) / admin (act) |
| `/admin/epdr/endpoints` | **Endpoints** — complete endpoint inventory; the drawer links to *Request scan or isolate* | site staff (read) / admin (act) |
| `/admin/epdr/threats` | **Threats** — detection list | site staff / admin |
| `/admin/epdr/playbooks` | **Playbooks** — saved versions, recommendation-only operational bindings, local threat review and Incident handoff | site admin |
| `/admin/epdr/approvals` | **Actions** — execution health, provider execution requests (request → approve → worker), and the collapsed *local decision records* (send nothing; an approved record links to a prefilled execution request) | site admin |
| `/admin/epdr/activity` | **History** — read-only ledger of everything recorded | site admin |
| `/admin/epdr/settings` | **Settings** — *Provider execution* (site/deployment write gates), notifications, detection, safeguards, site kill switch | site admin |

The header badge reads "Monitoring · read-only" while either write gate is closed and "Actions need approval" when the configured gate mode permits requests. It is display-only: credentials, allowlists, target freshness, safeguards and runtime checks can still block execution. A recently synchronized source or an empty priority queue never establishes that a site is safe; inventory, detections and provider target evidence refresh independently.

### Display and scheduling time zones

Personal EPDR display preferences use a named IANA time zone (including UTC, WIB, WITA and WIT). An unset preference inherits the site's notification scheduling zone, falling back to UTC. Stored event timestamps remain UTC instants. Daily threat trends must aggregate and zero-fill using that same effective display zone, not merely relabel UTC midnight.

Notification quiet hours and digest hours use the separate site scheduling zone. Existing policies retain UTC until explicitly changed. The legacy database field `digest_hour_utc` retains its name for compatibility; its hour is interpreted in the policy's explicit `time_zone`. Digest deduplication includes the site, recipient and local calendar date, so a recipient in multiple sites does not lose another site's digest.

### Operational playbooks and simulation history

A saved simulation version remains immutable simulation history. An operational binding pins one saved version to the current site, connection and account revision, with a supported response recommendation (`scan` or `isolate`). Activating a binding enables recommendation evaluation only; it neither opens execution gates nor grants approval.

The operational flow is: newly ingested cloud detection → current source evidence and binding filters → persisted recommendation → explicit operator request → audited administrator approval → existing dispatch worker → observed result or review. A local review decision is not provider approval. Older account revisions, missing target identity, incomplete or stale read evidence, endpoint safeguards and ignored detections must never silently become executable requests. A paused binding stops new evaluations; historical recommendation evidence remains available for audit.

Bindings and their newest recommendations appear in the **Operational playbooks** library at the top of `/admin/epdr/playbooks`; the existing simulation authoring and local review stay available below it. Requesting an action from a recommendation is a second explicit confirmation. The request re-checks that the binding is still active for the current connection/account revision, that the recommendation still matches the requested endpoint and action, and that its read evidence is the latest source read. The request and its immutable provenance link are recorded in one transaction as `pending_approval`; a superseded recommendation is rejected rather than silently reused.

## 2. Role model

- **Superadmin**: connection credentials, global kill switch, action allowlist, per-site/global ceilings.
- **Site admin**: site rules, detection/safeguard settings, approve/reject actions, activate modes (second-admin confirmation).
- **Site staff**: read-only Endpoint Security + Threats.

## 3. Setup sequence (pilot)

### Credential and access model

- **API key**: one shared REST header, `WatchGuard-API-Key`, used with both RO and RW credentials. It is not an OAuth Access ID or password and is not sent to the token endpoint.
- **Access ID + matching password**: one OAuth credential pair per access level (RO or RW). OAuth uses Basic authentication at the regional `/oauth/token` endpoint with `grant_type=client_credentials` and `scope=api-access`. Never mix fields from different pairs.
- **Region**: select the account's hosting region. Japan (`jpn`) maps to the fixed host `api.jpn.cloud.watchguard.com` for OAuth and REST; no custom host is accepted. Other supported regions keep their own fixed mappings.
- **Reads**: prefer a complete RO pair. Use the complete RW pair as read fallback only when both RO fields are absent from the saved connection. Blank form fields preserve saved credentials; they do not remove RO. Incomplete, undecryptable, invalid or rejected RO is an error to resolve, never permission to silently fall back to RW.
- **RW connection test**: obtains a fresh OAuth token and performs GET probes only. Success proves authentication and the tested read access, not mutation permissions. It sends no provider action and does not authorize writes.
- **Provider writes**: storing RW credentials or activating reads does not enable writes. Both global and site write gates, both action allowlists, approval by a currently-authorized site administrator (the requester may approve), and a running dispatch worker are required; approval is recorded in the activity log; kill switches and other execution checks still apply (§11).
- **Local review**: reviewing evidence, recording local outcomes and closing a local review never sends provider actions. Provider execution is a separate explicit request/approval/worker flow; a local review is not its approval.

1. Rotate WatchGuard credentials in Console; enter them in `/admin/settings` (write-only fields).
2. Save connection as **disabled draft**, then **Test connection** — verify Auth, Account, Endpoint Security, ThreatSync separately.
3. Confirm account/site ownership in the UI (never from screenshots).
4. After operator approval for read-only ingestion, enable the connection and follow the worker startup checks below to baseline endpoints. Test connection checks access; it does not populate inventory. A disabled draft is never polled.
5. Review the two disabled simulation templates before enabling any rule.
6. Simulation → review → request automatic (min simulation days) → independent admin confirms. These modes do not unlock real provider writes.

### Worker startup and first-sync checks (operator only)

The commands below are instructions for an authorized operator, not development
verification steps. Do not run workers, migrations, live API probes or credential
checks as part of automated code review. Never paste credentials or raw provider
errors into logs, tickets or chat.

- The `watchguard-worker` Compose service reuses `dc-check-app:latest`, the image's
  archived `scripts/`, `lib/` and dependencies, and the existing `.env` runtime
  convention. No separate image, entrypoint or credentials are needed. Confirm
  the deployed runtime env file is operator-managed; do not print its contents.
- Confirm committed migrations have already been applied by the approved release
  procedure and the app is healthy. Both update scripts include the worker in
  their post-migration service restart list. The service depends on app health;
  its inherited HTTP healthcheck is disabled because it is not a web server.
- Check service presence/status with `docker compose ps watchguard-worker`.
  After approving read-only ingestion, start it with
  `docker compose up -d watchguard-worker`. Use the same Compose/env-file options
  as the existing deployment. This starts real scheduled reads for enabled
  connections; it does not authorize any provider mutation.
- For an operator-approved endpoint-only baseline instead of starting the loop,
  use `docker compose run --rm --no-deps watchguard-worker npm run watchguard:worker:run-once -- --only=endpoints`
  after the app/schema are ready. Avoid concurrent baseline/loop workers.
  `--only` restricts execution to the named registered job; unknown/empty names
  fail. Exit status is nonzero if any job or connection query fails.
- Review `docker compose logs --tail=100 watchguard-worker` for pass counts, then
  check inventory and last-sync status in `/admin/epdr`. Zero rows alone is not
  proof of successful sync. A `0 ran, 0 failed` pass can mean no enabled
  connections or jobs not yet due. Failed jobs do not block other connections.
- The loop checks every minute; endpoint/detection cadences are per connection.
  Successful job timestamps survive passes in memory; failed jobs retry next
  pass. Restarting the worker intentionally resets cadence and makes all jobs
  due. Do not use repeated restarts as a sync health check.
- Stop ingestion with `docker compose stop watchguard-worker` if required.
  The read-only transport lock remains mandatory in every startup mode. The worker
  also hosts the gated write dispatcher/observer from §11; those jobs do nothing
  while either write gate is off.

## 4. Kill switch / rollback

- **Global kill switch** (`/admin/settings`) and **site kill switch** (`/admin/epdr/settings`) both block all new provider writes and automation closure while reads continue. Checked immediately before dispatch/closure.

## 5. Secret rotation / account change

- Blank secret fields preserve stored values; non-blank = rotate (bumps `credential_revision`, invalidates tokens/tests). Replacing an Access ID requires its matching password in the same save. Explicit clear removes both RO/RW pairs and the API key, pauses the connection, and invalidates its test result.
- Read resolution uses one complete credential pair: prefer RO, or use RW only when both saved RO fields are absent. A partial, undecryptable, invalid or rejected RO pair is an error, not permission to mix credentials or silently retry with RW.

### Connection troubleshooting after deployment

1. Check whether the site connection is **enabled** before diagnosing credentials. Testing an existing connection must preserve its enabled state; testing a new connection leaves it as a draft. A paused connection is intentionally excluded from background ingestion.
2. Run **Save & test connection** after any credential/account change. The diagnostic requests a fresh OAuth token before probing REST services. Old results and results from another credential/account revision must not be used as activation evidence.
3. Interpret the stage, source and HTTP status, not just `auth`: an OAuth failure prevents REST probes, so skipped account/device/threat checks are not three additional provider permission failures. Read source can be RO or explicitly labelled RW fallback.
4. OAuth uses the regional `/oauth/token` URL with Basic Access ID/password and `client_credentials` / `api-access`; Account ID and API key are used by REST, not the token request. If OAuth passes but a REST probe fails, investigate that service's account access, API key and entitlement. A 400/401 category alone does not prove a password is wrong.
5. The RW diagnostic performs authentication and GET probes only. Passing it does **not** verify mutation permission or authorize writes. Never enable provider-write gates as a connection workaround.
6. Keep credentials out of shell history, tickets and screenshots. Rotate exposed credentials using the encrypted settings form. Do not repeatedly retry rejected passwords or silently switch failed RO authentication to RW.

These steps describe operator checks after the patch is deployed; local mock tests do not establish that production credentials are accepted by WatchGuard.
- Changing region/account bumps `account_revision`, disables dispatch and requires retest; old inventory/evidence is preserved, never migrated to the new account.

## 6. Modes and progression

- New rules always start **simulate**. Material edits reset to simulate.
- **approval** creates pending requests; **automatic** requires the site-admin-configured simulation minimum and a different admin's confirmation.
- Advanced actions (isolate/unisolate/assign_config/ThreatSync commands) are **approval-only** — never automatic.

### Widening the write allowlist

A request needs its action in **both** lists: the deployment ceiling (`watchguard_global_settings.allowed_actions`) and the site list (`epdr_site_settings.allowed_actions`). The site list narrows the ceiling; an empty site list allows nothing.

- Preferred: superadmin opens EPDR → **Settings** → *Provider execution*, widens the **deployment action ceiling**, then the site admin enables the site gate and checks the site subset. The same global ceiling is editable under EPDR → Settings → *Global safeguards* → *Allowed actions*.
- Script alternative (same effect, explicit site, dry-run first):

```bash
npm run epdr:enable-writes -- --list-sites
npm run epdr:enable-writes -- --site-id=<id>
npm run epdr:enable-writes -- --site-id=<id> --confirm
# Optional ThreatSync actions:
npm run epdr:enable-writes -- --site-id=<id> --actions=scan,isolate,unisolate,reboot,assign_config,ts_quarantine --confirm
```

The script only widens lists, never removes an action, never touches a kill switch, and writes a system audit row. Writes still require site-admin approval (the requester may approve), recorded in the activity log, pass cooldowns/hourly caps, and stay blocked by either kill switch. `uninstall_protection`, `repair`, `transact` and `provider_comment` remain unavailable because they have no verified provider contract.

## 7. Reason codes (policy/decision)

See `lib/epdr/reasons.ts`: `no_match`, `block_kill_switch_global/site`, `block_action_not_allowed`, `block_automation_hold`, `block_endpoint_removed`, `block_endpoint_offline`, `block_data_stale`, `block_cooldown`, `block_exclusion`, `approval_server/critical/no_auto/unknown_type/unresolved_target`, `breaker_paused`, `simulated`.

## 8. Unsupported / manual fallback

- **Repair protection / repair agent** is `BLOCKED_UNSUPPORTED`: the public Endpoint Security API (1.5.2) has no repair/reinstall command. The health ladder escalates to manual-repair Incidents (`epdr_health_cases` stage 2/3); reboot is a separate operator-enabled policy action, never a silent repair substitute. No private Console endpoints or browser automation.

## 9. Release checklist (no live step auto-authorized)

- [ ] Rotated credentials entered in UI.
- [ ] Account/site confirmed in UI.
- [ ] Baseline endpoint/detection sync complete.
- [ ] ThreatSync Console automation-policy overlap reviewed (dc-check categories must not overlap Console policy).
- [ ] First scan target explicitly approved by operator.
- [ ] Task/result compatibility verified before any auto-close.
- [ ] Simulation review + two-admin activation.
- [ ] Monitor per-site caps/breaker/observations.
- [ ] Kill-switch rollback rehearsed.
- **Operator must separately authorize live commands, production rules, and migrations.**

## 10. Evidence retention
- Provider raw evidence/result visibility is bounded to site role; retention is UI-backed within global minimum; prune only expired, non-referenced data in bounded batches. Endpoint-only inventory is never registered as an asset or a fake checklist item.
## 11. Provider write execution (RW)

This section documents the opt-in execution path added in migration `0084_epdr_provider_writes`.
It replaces the previous "mutations are unreachable" statement with a gated pipeline. The
read-only transport (`lib/watchguard/guard.ts`) is unchanged and still refuses every write;
writes travel through a separate allowlist (`lib/watchguard/write-guard.ts`).

### 11.1 Current default

Both gates ship **off**:

- `watchguard_global_settings.provider_writes_enabled` (superadmin)
- `epdr_site_settings.provider_writes_enabled` (site admin)

With either gate off, `getEpdrExecutionOptions()` reports `writeEnabled: false` and the request
form is disabled. No request can be created, approved or dispatched.

### 11.2 Verified operations

Only operations recorded as verified in
`docs/superpowers/plans/2026-11-17-epdr-playbook-proper/RW_CAPABILITY_MATRIX.md` exist in the
registry. Everything else is `unsupported` and cannot be selected. A verified *write* contract
does not imply verified *completion* observation; §11.5 lists what the worker can confirm.

Deliberately **not** implemented: uninstall protection, `/transact` batch, standalone provider
comment, repair, automatic (no-approval) execution, and multi-target bulk sends.

### 11.3 Request lifecycle

```text
pending_approval → queued → dispatching → in_progress → completed
                                  ↘ outcome_unknown → (observation) → completed | needs_review
                                  ↘ failed
pending_approval | queued → cancelled
```

- A request is created by one site admin and shows **nothing sent**.
- Approval requires a currently-authorized **site admin** (the requester may approve) and re-validates every gate
  against fresh state, including a rebuilt snapshot of the exact target. The approver's snapshot
  hash must equal the stored snapshot hash. Approval is recorded in the activity log, including
  the requester and approver; requester approval is identified as self-approved. Local rejected
  decisions are not labelled self-approved.
- The approval UI requires opening the request, reviewing the frozen target, parameters and
  revision values, and ticking an explicit confirmation. There is no one-click approval from the
  list.
- Any material change (target, parameters, account/credential revision, evidence generation)
  invalidates the approval and the request moves to `needs_review` instead of sending.
- Approvals expire and never extend past the request's own window. An expired approval never
  authorizes a send.

### 11.4 Dispatch safety

- The attempt row is committed **before** the provider request.
- One attempt per request. There is no retry for a write; a GET-style retry is never applied.
- Timeout, network failure, 5xx, redirect, or a 2xx without the documented receipt field become
  `outcome_unknown`. The request is **never re-sent automatically**.
- A dispatch lease that expires without a published result is converted to `outcome_unknown` by
  `recoverStaleDispatchLeases`. Lease expiry is not permission to resend.
- A stale worker generation cannot publish; the CAS on `generation` rejects it.

Known limits of this release:

- Rate limit and cooldown are checked per claim, not reserved atomically. Two workers claiming
  different requests for the same site/endpoint in the same instant can exceed the intended cap;
  run a single worker, as the deployment does.
- Revalidation happens immediately before the claim; a kill switch or pause flipped during the few
  seconds between claim and HTTP send cannot cancel that one send. The next claim is blocked.
- Scan completion aggregates the first page of task jobs. A task with more jobs than that page can
  be under-observed; it is never treated as clean.
- `needs_review` is closed by one administrator with a note, after which a new request may be made.
  The new request still requires a fresh site-admin approval (the requester may approve), recorded in the activity log, but the closure itself does not
  prove the earlier operation was not performed.

### 11.5 Observation

`runProviderObservePass` reads provider state only and keeps running while a kill switch is
active or the connection is disabled. Scan observation correlates the exact
`dcheck-<requestId>` marker in `task_name` and aggregates every job status; a completed task is
never treated as proof the endpoint is clean. Zero matches leave the request unresolved (bounded
by the observation deadline and attempt budget, after which it moves to `needs_review`).

Observation coverage is deliberately uneven and shown in the UI:

| Action | Completion evidence |
|---|---|
| `scan` | Task jobs all reported success. Result pages are not fetched. |
| `isolate`, `unisolate` | Explicit recognized device isolation state only. |
| `reboot`, `assign_config` | None verified. First observation moves the request to `needs_review`. |
| ThreatSync actions and incident status | None verified. First observation moves the request to `needs_review`. |

ThreatSync writes additionally require a recorded provider incident target. This repository has no
ingestion writer for `epdr_provider_incident_targets`, so those actions currently fail creation with
`target_unresolved` unless the table is populated by an external, authorized process. The id is
never inferred from an Endpoint Security device id.

The worker only enumerates **enabled** connections, so disabling a connection also pauses its
observation passes. Resolve outstanding requests or re-enable the connection before disabling it
for a long period.

### 11.6 Kill switch

Global and site kill switches stop **new sends**. Observation and reconciliation continue, so a
request that may already have been performed is still resolved. Setting a kill switch is not
rollback: it does not undo anything already accepted by the provider.

### 11.7 Compensation

`unisolate` is a separate request with its own approval. Reboot, process termination and file
quarantine have no in-app undo. Deployment rollback preserves `epdr_actions` and `epdr_attempts`
and leaves unresolved `outcome_unknown` rows visible.

### 11.8 Live activation checklist (requires explicit operator authorization)

Nothing below is executed by tests or by the application on its own.

- [ ] Rotate the exposed RW/RO credentials and store the new values through the encrypted
      connection fields. Never place them in code, docs, tickets or chat.
- [ ] Apply migrations up to `0086_epdr_single_admin_approval` on the target database.
- [ ] Run `npm run watchguard:worker -- --only=dispatch --run-once` and confirm the log shows
      `pass complete: N ran, 0 failed`, **no new `epdr_attempts` rows**, and every request still
      `pending_approval`/`queued` while both gates are off.
- [ ] Enable the global gate as superadmin, then the site gate, with a narrow action list
      (start with `scan` only).
- [ ] Create one request on one endpoint and confirm it stays `pending_approval` with no attempt
      row.
- [ ] Inspect the request, confirm the approved device id and revisions, then approve as a
      site admin (the requester may approve), verify the approval in the activity log, and confirm
      exactly one `epdr_attempts` row.
- [ ] Observe the outcome and confirm a completed scan is not presented as a clean endpoint.
- [ ] Rehearse the kill switch: new sends stop, observation continues.
- [ ] Only then widen the action list, one action at a time.

### 11.9 Rollback

- Turn off the site gate, then the global gate, then raise the kill switch.
- Do not delete `epdr_actions` or `epdr_attempts`: they are the audit trail.
- Resolve every `outcome_unknown` request before re-enabling writes, so a possibly-performed
  operation is not repeated.
- Requests stuck in `needs_review` are closed with the explicit review action ("Close after
  review"), which records a note and releases the active-intent lock. It makes no claim about what
  the provider did.


## 12. Hardening release (0085): atomic limits, confirmed ThreatSync targets, observation, monitoring, retention

### 12.1 Per-site limits and atomic reservation

- Effective hourly cap = LEAST(site max_actions_per_hour, global max_actions_per_hour_per_site); a site value
  of NULL follows the global ceiling. Effective cooldown = per-site execution_cooldown_minutes (default 10,
  0 disables). Both are edited in the execution-center settings section; the site cap may narrow but never
  raise the global value.
- The dispatcher reserves atomically: one transaction locks the connection row, reads the limits, counts
  committed dispatch attempts for the hour, then claims one request with a cooldown anti-join and
  FOR UPDATE SKIP LOCKED. A cooled-down endpoint can no longer block the queue head. The attempt row and its
  claimed event commit before any HTTP call.
- epdr_attempt_events is append-only at the database level. Corrections appear as new events; the trigger
  rejects UPDATE and DELETE. Event vocabulary: claimed, sent, accepted, ambiguous, aborted, observed.
- An aborted claim (gate flipped, snapshot changed before send) returns the request to queued or needs_review,
  marks the attempt aborted and clears dispatched_at: no cooldown attaches to an endpoint that was never
  contacted.
- Ops: watch /api/metrics (epdr block) and /admin/epdr/approvals (execution health panel). The worker compose
  service now has a real healthcheck (scripts/healthcheck-watchguard.ts, exit 1 on a stale heartbeat or stuck
  thresholds; thresholds env-tunable via EPDR_* variables).

### 12.2 ThreatSync confirmed targets (required before any TS action)

- The provider_sync job ingests incidents/targets as unreviewed. It never auto-confirms and never derives a
  ThreatSync entity id from a device id (and vice versa).
- An operator must confirm each target on /admin/epdr/threats: pick the endpoint, confirm (or reject with a
  reason). Only confirmed targets whose incident matches the connection's current account revision authorize
  ThreatSync actions and link detections to endpoints.
- Detections no longer fall back to comparing entity ids with device ids. Historical detections linked that
  way appear in the mislink report on the same panel; history is not rewritten automatically.
- Retention windows (per site, Settings > EPDR): attempts of terminal requests are deleted after
  execution_attempt_retention_days (default 90); result/response payloads are redacted after
  execution_result_retention_days (default 180). Requests, snapshots and approval records are permanent.

### ThreatSync read window and sync bookkeeping

- The worker explicitly reads ThreatSync with `duration=7D` and `sortBy=id asc`, using the sorted key as the pagination cursor. Older stored records are retained under the existing retention policy, but are not re-read outside this seven-day provider window. A successful sync is not evidence of a full-history refresh.
- Fresh ThreatSync sync evidence records the window as `threatsync_7d`. Historical `provider_default` evidence has an unknown window until a fresh sync publishes explicit window evidence; do not reinterpret old evidence as seven-day coverage.
- Provider sync SQL bookkeeping now explicitly casts null values to the expected SQL types, fixing the null-cast failure. This is a bookkeeping fix, not a change to the read window, retention policy or write authorization.

### 12.3 ThreatSync observation

- Command actions read GET /actions/{actionId}; only inProgress and performed are recognized. performed
  completes the request; anything else is unreadable and retries a bounded number of times before
  needs_review.
- ts_incident_status completes only when the provider reports exactly the requested status.

### 12.4 Residual risks

- Closing a needs_review request remains a single-admin decision. It records a note and releases the
  active-intent lock; it does not prove the earlier operation did not run. Retry still requires a fresh
  site-admin approval (the requester may approve), recorded in the activity log.
- The retention worker deletes technical evidence (attempts, receipts) after the configured windows; the
  decision records remain but the raw evidence does not. Export what you need before the window closes.
- The expired-approval sweep cancels lapsed approvals automatically; a request that was genuinely still
  wanted must be requested and approved again.
