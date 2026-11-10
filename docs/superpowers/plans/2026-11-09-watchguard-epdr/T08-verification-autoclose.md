# T08 — Verification, auto-close, reopen, automatic mode

Depends on: T07 · Spec: §5.3, §5.4, §5.5, §6, §8 · Migration: `NNNN_epdr_verification`

## Goal

Close the loop: a completed scan is verified, the episode is resolved automatically only when evidence is sufficient, escalates otherwise, and automation is protected by a circuit breaker and exclusions. After this ticket, `automatic` rules are allowed to dispatch.

## Data model

```sql
ALTER TABLE epdr_workflows
  ADD COLUMN verification_started_at timestamp,
  ADD COLUMN rescan_count integer NOT NULL DEFAULT 0,
  ADD COLUMN close_decision jsonb,          -- {decision, reasons[], ruleId, at}
  ADD COLUMN ts_sync_state text;            -- pending | ok | failed

CREATE TABLE epdr_exclusions (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  match_md5 text, match_threat_name text,
  endpoint_id integer REFERENCES epdr_endpoints(id) ON DELETE CASCADE,  -- null = all endpoints of the site
  reason text NOT NULL,
  expires_at timestamp NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  CHECK (match_md5 IS NOT NULL OR match_threat_name IS NOT NULL)
);

ALTER TABLE epdr_site_settings
  ADD COLUMN breaker_max_actions integer NOT NULL DEFAULT 20,
  ADD COLUMN breaker_window_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN breaker_same_threat_endpoints integer NOT NULL DEFAULT 5;
```

## Verification (`lib/epdr/verification.ts`, worker job `verify`)

For workflows whose latest scan action reached `completed` or `failed`:

| Scan outcome | Next |
|---|---|
| `failed` / expired / timeout | workflow `needs_review`, incident stays In Progress, notify |
| `completed`, `affected_items > 0`, `rescan_count = 0` | create a second scan action (same rule, `mode` inherited, guardrails re-run), `rescan_count = 1` |
| `completed`, `affected_items > 0`, `rescan_count ≥ 1` | `needs_review`; create an `isolate` **proposal** only when T10 is enabled, always `pending_approval` |
| `completed`, `affected_items = 0` | workflow `verifying`, `verification_started_at = now()` |

`decideClose(workflow, rule, detections, actions, now)` — pure — runs for `verifying` workflows after `observation_minutes`. Close allowed only if all hold (spec §5.4):

Implement CONTRACTS C6's evidence gates, not only affected_items. Latest qualifying scan on every target must actually start after latest actionable occurrence; execution, recipient/status/results pages and clean semantics must be validated. Old failed attempts may be superseded by a later qualifying scan; missing/null/partial results never mean zero. Detection coverage must be fresh and complete through observation, with no material evidence/entity changes, outstanding required remediation or hold.

Closure mode is a real UI choice within the current global ceiling: auto -> conditional resolve; approval -> durable epdr_close_requests (frozen evidence generation/revision, requester, approver, expiry, CAS state); manual -> workflow ready_for_manual_close. Add awaiting_close_approval and ready_for_manual_close to the shared workflow enum. Default templates require review for Critical/IOA/Exploit/server/critical; avoid a hard-coded category override that silently ignores UI. Any IOA/Exploit approval still explains that clean file scan alone cannot prove resolution. Recheck all evidence when approving/closing.

Resolve DC incident with Security category, factual resolution note (scan/evidence, not an unsupported claim of cleaning), system attribution, append-only decision and workflow state in one conditional transaction. Only native exclusively EPDR threat episodes qualify. Verified remains manual. For provider closure use C3 aggregation over all linked entities/workflows and C6 outbox; unresolved other targets block provider closed even if this DC episode resolves. Re-read provider evidence before close; supersede old read/close intentions on recurrence. Report sync pending/failed independently.

A new detection during `verifying` sends the workflow back to `detected` (T06 evaluation runs again). Reopen after resolution is already handled by T05 correlation; a second reopen may add an isolate proposal (T10) alongside policy-approved diagnostic scanning; it does not silently replace the user's full-scan requirement.

## Circuit breaker (checked by dispatcher and evaluation)

- More than `breaker_max_actions` automatic dispatches in `breaker_window_minutes` for a site, or the same `threat_key` on ≥ `breaker_same_threat_endpoints` endpoints within the window → set `automation_paused_at/reason`, create one epdr_campaigns aggregate with unique site/threat/window key and membership links to existing endpoint Incidents, notify (C3). Do not create a target-less Incident that violates T04's CHECK. While paused, automatic decisions become `needs_approval`. Unpause is a site-admin action, audited.

## Exclusions

- Closing an EPDR incident with resolution "False Alarm" offers to create an exclusion (md5 or threat name, this endpoint or whole site, reason, expiry ≤ 90 days, default 30).
- Active exclusion keeps detection visible with explicit reason/provenance. UI independently selects suppress automatic command and/or suppress new Incident creation; existing Incident evidence is never hidden or auto-resolved by an exclusion. C8 global limits and protected target review apply.
- Exclusions list with expiry in `/admin/epdr/settings`.

## Hold / take over

Incident EPDR panel buttons: Hold automation (sets `automation_hold`), Release, Close with reason (manual close also syncs ThreatSync).

## Acceptance

- [ ] `decideClose` covers every condition with table tests; any missing evidence yields "not closed" with a reason.
- [ ] Rescan happens at most once per episode; second dirty result escalates.
- [ ] ThreatSync close failure never triggers another scan.
- [ ] Breaker pause and resume have site-admin UI, explanation, CAS/audit; atomically reserved per-site limits prevent burst races. Exactly one campaign aggregate is created per window.
- [ ] One endpoint succeeds in a multi-entity provider incident: only its DC episode may resolve; provider incident stays open until all targets qualify.
- [ ] Stale/partial detection coverage, delayed results, recurrence generation, hold or superseded outbox close cannot resolve an Incident.
- [ ] Close approval has real persistence/API/UI, expiry and revision-safe final revalidation.
- [ ] Expired exclusions stop applying without manual cleanup.
- [ ] End-to-end test with mocked client: detection → incident → automatic scan → completed clean → observation → resolved → ThreatSync closed; and the recurrence → reopen path.

## Tests

`lib/epdr/verification.test.ts`, `lib/epdr/breaker.test.ts`, `lib/epdr/exclusions.test.ts`, `lib/epdr/e2e.test.ts` (in-memory flow through all jobs with fake clock).

## Hand-off
