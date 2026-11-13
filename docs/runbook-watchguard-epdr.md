# WatchGuard EPDR — Operator Runbook

Status: **implemented read-only** (`WATCHGUARD_READ_ONLY_LOCK = true`). All real
provider adapters are read-only; every mutation is blocked before network with
`WATCHGUARD_READ_ONLY_BLOCKED`. There is no UI/config/env unlock. Enabling real
writes requires a separate, explicit operator authorization and a reviewed code
change.

## 1. Entry routes

| Route | Page | Access |
|---|---|---|
| `/admin/settings` (WatchGuard card) | Per-site connection + superadmin global controls | superadmin |
| `/admin/epdr` | Monitor › Endpoint Security | site staff (read) / admin (act) |
| `/admin/epdr/threats` | Threats + detection list | site staff / admin |
| `/admin/epdr/settings` | Site rules, detection, safeguards | site admin |

## 2. Role model

- **Superadmin**: connection credentials, global kill switch, action allowlist, per-site/global ceilings.
- **Site admin**: site rules, detection/safeguard settings, approve/reject actions, activate modes (second-admin confirmation).
- **Site staff**: read-only Endpoint Security + Threats.

## 3. Setup sequence (pilot)

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
  The read-only transport lock remains mandatory in every startup mode; there
  is no environment flag or CLI option that permits scans, repair or writes.

## 4. Kill switch / rollback

- **Global kill switch** (`/admin/settings`) and **site kill switch** (`/admin/epdr/settings`) both block all new provider writes and automation closure while reads continue. Checked immediately before dispatch/closure.

## 5. Secret rotation / account change

- Blank secret fields preserve stored values; non-blank = rotate (bumps `credential_revision`, invalidates tokens/tests). Explicit clear is a separate action.
- Changing region/account bumps `account_revision`, disables dispatch and requires retest; old inventory/evidence is preserved, never migrated to the new account.

## 6. Modes and progression

- New rules always start **simulate**. Material edits reset to simulate.
- **approval** creates pending requests; **automatic** requires the site-admin-configured simulation minimum and a different admin's confirmation.
- Advanced actions (isolate/unisolate/assign_config/ThreatSync commands) are **approval-only** — never automatic.

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