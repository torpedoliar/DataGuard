# T07 — Action engine: approval + scan dispatch + task tracking

Depends on: T06 · Spec: §5.3, §6, §8, §12 · Migration: `NNNN_epdr_actions`

## Goal

The first provider writes. Rule decisions `needs_approval` and `automatic` become actions; approved actions dispatch a full system scan; task status is tracked per endpoint. Verification and closure are T08.

This ticket implements approval mode; automatic dispatch remains disabled until T08 and operator activation. Production writes are not authorized by this document. CONTRACTS C1/C3/C5/C6 are mandatory: durable command identity, current account revision, recipient coverage, provider-sync outbox and evidence.

## Data model

```sql
CREATE TABLE epdr_actions (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id),
  connection_id integer NOT NULL REFERENCES watchguard_connections(id),
  incident_id integer REFERENCES incidents(id) ON DELETE SET NULL,
  endpoint_id integer NOT NULL REFERENCES epdr_endpoints(id),
  evaluation_id integer REFERENCES epdr_rule_evaluations(id),
  rule_id integer REFERENCES epdr_rules(id),
  action_type text NOT NULL,
  params jsonb NOT NULL,                 -- frozen at creation, server-built
  mode text NOT NULL,                    -- approval | automatic | manual
  state text NOT NULL,                   -- see state machine
  idempotency_key text NOT NULL UNIQUE,  -- action_type:endpoint:incident:evaluation
  requested_by integer REFERENCES users(id),   -- null = system
  approved_by integer REFERENCES users(id), approved_at timestamp,
  approval_expires_at timestamp,
  cancelled_by integer REFERENCES users(id),
  lease_owner text, lease_expires_at timestamp,
  attempt integer NOT NULL DEFAULT 0,
  dispatched_at timestamp,
  provider_ref text,                     -- task_id / action id
  provider_job_id text,
  provider_status integer, provider_status_at timestamp,
  affected_items integer,
  result jsonb,                          -- redacted provider result
  error text,                            -- redacted
  deadline_at timestamp,                 -- dispatched_at + execution window
  created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
);
CREATE INDEX epdr_actions_state_idx ON epdr_actions (state, lease_expires_at);
CREATE INDEX epdr_actions_endpoint_idx ON epdr_actions (endpoint_id, action_type, created_at);
```

## State machine (`lib/epdr/actions.ts`)

```text
pending_approval ─approve─▶ queued ─claim─▶ dispatching ─accepted─▶ in_progress ─task terminal─▶ completed | failed
      │ reject/expire            │ cancel          │ timeout/network         │ deadline passed
      ▼                          ▼                 ▼                         ▼
   cancelled                 cancelled        outcome_unknown ─reconcile─▶ in_progress | failed | needs_review
automatic rules start at queued.
```

Every transition is one conditional `UPDATE ... WHERE id = $1 AND state = $expected [AND lease_owner = $me] RETURNING *`; zero rows → the caller lost the race and does nothing. One function per transition; no other code writes `state`.

Approval rules: approver != requester; system proposals may be approved by a current site admin. Expiry is a site UI setting within global max (default24h). Freeze account/credential revision, evidence generation, target/options/rule version; recheck role membership and approvals at dispatch. New criticality or scope needing approval cannot run on an old automatic decision. Add epdr_action_incident_links (command sharing), durable attempt records and unique active scan/endpoint constraint per C5. Store numeric scan status separately from string provider action status and execution success separately from result completeness.

## Dispatcher (`lib/epdr/dispatcher.ts`, worker job `dispatch`)

1. Claim up to 10 `queued` actions with a 2-minute lease (`FOR UPDATE SKIP LOCKED` + conditional update).
2. Re-check C5: kill switches/hold/account revision and capability blockers; current requester/approver site role and frozen revisions; active-command/cooldown and site/global limits under lock. Automatic becoming protected/paused returns to pending_approval; temporary unavailable data is deferred/reviewed; irrecoverable revoked target cancels. Do not treat a server approval flag as an unconditional bypass or cancel every transient failure.
3. Build the payload server-side from `action_type` + frozen `params` + endpoint `wg_device_id`:
   - `scan`: `startImmediateScan({ device_ids:[id], task_name:"dc-check action:<unique-action-key> incident:<incident-id>", task_description, scan_scope: params.scanScope ?? 0, detect_hacking_tools:true, detect_suspicious_files:true, scan_compressed_files:true, execution_window_expiration: formatProviderDuration(params.windowHours ?? 24) (24h = "1.00:00:00") })`.
   - `reboot`: `rebootDevices([id], params.countDownType ?? 7)` (T09 uses it).
   - other types throw "not enabled" until T10.
4. Accepted → `in_progress`, store `provider_ref`, `dispatched_at`, `deadline_at`. Error with `outcomeUnknown` → `outcome_unknown`. Definite provider error (4xx) → `failed` with redacted error.
5. Expired leases of `dispatching` rows → `outcome_unknown` (never re-dispatch).
6. Transactional effects after accepted in_progress: conditional DC Open -> In Progress, append update/audit intent, link workflow and enqueue provider read/comment intentions. T07 creates epdr_provider_sync_outbox per C6 (type, provider incident, dedup marker, account revision, evidence generation, state, retries/error). Its worker reconciles status/comments independently; stale intentions are superseded, kill switch blocks provider writes. Lost API responses/5xx follow C5. No task is re-sent because status/comment sync failed.

## Task tracker (worker job `tasks`)

For `in_progress` and `outcome_unknown` scan actions:
- outcome_unknown: reconcile by exact unique action marker + current account revision + intended recipients/scope/attempt window (C5). One verified match may be adopted; zero after reconciliation window or multiple/ambiguous matches -> needs_review, never second POST.
- in_progress: get all job/status/result pages and select the matching scan attempt, not blindly the latest unrelated repetition. Map 0/1 -> stay; 2 -> completed execution plus pending evidence until results are read completely; 3/4/5/7 -> failed;6 -> stay. Store provider start_time/finish_time, nullable affected_items, recipient, job and evidence completeness. Unknown/null/shape errors cannot count as clean. No job before deadline -> failed/review.
- transient GET result failure retries read-only and blocks verification; it never resubmits the scan.
- Endpoint offline while waiting → workflow state `waiting_endpoint` (display only).

Spec §14 flags that `task_id`→jobs linkage and timing are unverified: log the raw responses (redacted) for the first actions per connection to confirm, and report findings in the hand-off.

## Audit

Every transition writes `logAuditManual` (worker) or `logAudit` (UI) with `siteId`, action id, type, endpoint host, rule version, actor, and result.

## UI

- Incident EPDR panel: actions list with state, provider status, timestamps; buttons Approve / Reject / Cancel (site admin, server-checked), "Request scan" (manual action, `mode='manual'`, still requires approval by a second admin).
- `/admin/epdr/threats`: "Awaiting approval" queue with frozen params and guardrail reasons; "Needs review" queue.
- Telegram notification to the site on `pending_approval`, `failed`, `needs_review` (reuse existing per-site chat config).

## Prerequisite fix (separate logical change; commit only if user requests)

`actions/siem-response-actions.ts` approve/cancel read-then-update by id only. Convert those transitions to conditional updates with affected-row checks, and switch `scripts/siem-response-worker.ts` audit to `logAuditManual`. Keep its behaviour otherwise identical; add tests for approve/cancel/claim races.

## Acceptance

- [ ] Concurrent approve vs cancel, and two dispatcher instances, never dispatch twice (tested with conditional-update races).
- [ ] Kill switch flipped between approval and dispatch → no provider call.
- [ ] Timeout on scan POST → `outcome_unknown` → reconciled from `/tasks`; no second POST.
- [ ] Requester cannot self-approve; expiry obeys current UI/global limits (default24h); revoked approver and changed scope cannot dispatch.
- [ ] Parallel episodes/rule versions targeting one endpoint still create at most one active full scan; command sharing and coverage are recorded. Ambiguous 5xx, duplicate task names and delayed results never trigger blind resend.
- [ ] Incident goes `In Progress` only after provider acceptance.
- [ ] The SIEM response race fix ships with tests.

## Tests

`lib/epdr/actions.test.ts` (every transition, races), `lib/epdr/dispatcher.test.ts` (rechecks, payload shape, error mapping, lease expiry), `lib/epdr/task-tracker.test.ts` (status mapping 0–7, adoption, deadline), `actions/epdr-actions.test.ts` (auth, self-approval, site isolation).

## Hand-off
