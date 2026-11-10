# T11 — Operational UI completion, rollout and handoff

Depends on: T10 · Spec: §9–§14 · Migration: only for explicitly identified remaining config/retention needs

## Goal

Deliver a usable operator-managed integration, not just functioning worker jobs. Close every REQUIREMENTS/C8 coverage row, document unsupported repair, and provide an auditable deployment/pilot handoff. No live activation authorized by this ticket.

## Scope

### Configuration/UI coverage

Create `docs/runbook-watchguard-epdr.md`: entry routes, en/id screenshots, role model, UI-to-settings mapping, reason codes, test connection per-service result, secret rotation, account change, site setup, default disabled templates, baseline/simulation/approval/automatic progression and rollback/kill-switch steps.

Audit C8 end-to-end: every business setting has persistence, authorized server action, validation, audit/version, UI help and effective-policy override explanation. Fill omissions in the owning module; record changes in its handoff. Neither manual SQL nor environment variables are needed to configure rules per site. Infrastructure bootstrap remains deployment-only: DB/session/encryption secrets, worker process, optional proxy/network setup.

UI must include worker heartbeat/job health, last-complete evidence coverage, unknown/incomplete records, queued/stuck actions/outbox, pause/resume and replay review. Expose retry of safe reads/status synchronization separately from endpoint command replay. Distinguish supported scan/monitoring, untested writes and blocked repair capability.

### Notifications, SLA and reports

- Existing site Telegram destinations selectable through UI. Configure alert events/summary windows, same-site PIC/default assignment and severity SLA dueDate; dedup notification attempts and surface failure without repeating commands.
- Metrics based on lifecycle timestamps: acknowledge and resolve time (define what counts as MTTA/MTTR), auto-resolved share, false-positive/recurrence rate, failure/unknown outcome, protection health per site. Avoid dividing endpoint totals by asset/checklist counts.
- Optional checklist evidence uses existing mapped assets only: show/attach source snapshot with fetch time and completeness; keep human audit submission intact. Endpoint-only inventory is never registered as an asset or fake checklist item.
- Provider raw evidence/result visibility is bounded to site role; define UI-backed retention within global minimum, preserve active Incident/decision audit references, prune only expired nonreferenced data in bounded batches. Include tested backup/restore and encryption-key dependency guidance.

### Release validation

- Add end-to-end mocked cases from REQUIREMENTS final acceptance, including staff navigation/site access, two accounts, no asset endpoint, multiple entities, false-positive/history, offline partial scan, changed settings, ambiguous write, delayed result and health manual fallback.
- Verify migrations forward on isolated DB seeded with existing asset incidents and active epdr cases; ensure a fresh install and upgrade path both work. Serialize schema/journal ownership.
- Run full `npm run test`, `npm run lint`, `npm run typecheck`; build and report environmental blockers honestly. No application test may contact WatchGuard.
- Deployment config includes worker `--run-once` diagnostics, graceful stop, heartbeat, bounded connection concurrency, UTC behavior and scheduler resume; healthy Next.js alone does not imply healthy worker.
- Prepare pilot checklist: rotated credentials entered in UI; account/site confirmed; complete baseline; native ThreatSync policy overlap reviewed; explicit target approval for first scan; task/result compatibility verified before any auto-close; simulation review; two-admin activation; monitor caps/observations; kill-switch rollback. **Operator must separately authorize live commands, migrations and activation.**

## Acceptance

- [ ] Every REQUIREMENTS row maps to passing test/demo or explicit blocked capability; auto repair cannot be marked done.
- [ ] Every C8 setting is operable in UI and server-validated, with no secret output.
- [ ] Runbook and release checklist are complete and local links valid.
- [ ] Full-suite/isolation migration/build outcomes and pending live validations recorded in handoff.
- [ ] No production credential, uploaded screenshot, private response dump, token, commit or deployment included without explicit request.

## Hand-off
