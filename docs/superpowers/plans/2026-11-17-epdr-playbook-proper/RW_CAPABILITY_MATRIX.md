# RW Capability Matrix

**Verified against public WatchGuard documentation on 2026-11-17. No credential, account data, or live API call was used.**

This document is the gate for enabling any provider write. An operation may be implemented only when this file records it as `verified`. Everything else stays `unsupported` in code, regardless of UI or settings.

## Evidence sources

| Source | Version | Used for |
|---|---|---|
| [Endpoint Security Management API](https://www.watchguard.com/help/docs/API/Content/en-US/endpoint_security/WES_endpoint_security/v1/WES_endpoint_security.html) | 1.5.2 | Endpoint scan, isolation, reboot, configuration assignment |
| [ThreatSync Management API](https://www.watchguard.com/help/docs/API/Content/en-US/threatsync/v1/threatsync_management.html) | 1.2.0 | ThreatSync actions, incident status |
| [Authentication APIs](https://www.watchguard.com/help/docs/API/Content/en-US/home.html) | v1 | OAuth token acquisition |
| [Panda Aether API](https://www.watchguard.com/help/docs/API/Content/en-US/panda/aether_endpoint_security/v1/aether_endpoint_security.html) | 1.6.2 | **Not used.** Different product line and different service prefix. |

The published OpenAPI YAML downloads (`developer.cloud.watchguard.com`) were served as `application/octet-stream` and could not be parsed in this environment. The HTML references above are the authoritative evidence used here. Any discrepancy discovered later must be corrected in this file before enabling the affected operation.

## Transport facts

| Fact | Value |
|---|---|
| Base URL | `https://api.{region}.cloud.watchguard.com/rest/` (region from the connection record) |
| Token | `POST /oauth/token`, HTTP Basic with access ID + password, form fields `grant_type=client_credentials` and `scope=api-access` only. The implementation sends no `audience` field. |
| Auth header | `Authorization: Bearer {access_token}` |
| API key header | `WatchGuard-API-Key: {apiKey}` |
| Content type | `application/json` for both `Accept` and `Content-Type` |
| Write credential | RW access ID + password. RO credentials must never be used for a write. |

## Endpoint Security operations

Service prefix: `/rest/endpoint-security/management/api/v1/accounts/{accountId}`

Device identifiers are Endpoint Security device IDs (`wg_device_id`). They are **not** ThreatSync `entityId` values.

| Operation | Method + path | Contract | Status |
|---|---|---|---|
| Immediate scan | `POST /immediatescan` | Body: `device_ids` (array), `task_name` (required), `scan_scope` (`0` whole device, `1` critical locations, `2` selected). Response carries `task_id`. Scope `2` requires selected-item fields this release does not implement, so only `0` and `1` are requestable. | **verified (scope 0/1)** |
| Isolate | `POST /devices/isolation` | Body: `device_ids`, optional allowed programs, user message, suppression flag. Response: `processed_device_ids`. | **verified** |
| Release isolation | `POST /devices/noisolation` | Body: `device_ids`. Response: `processed_device_ids`. | **verified** |
| Reboot | `POST /devices/action` | Body: `device_ids`, `action_type=1`, required `count_down_type` (`1` immediate, `2` 15 min, `3` 30 min, `4` 1 h, `5` 2 h, `6` 4 h, `7` 8 h). Response: `processed_device_ids`. | **verified** |
| Assign configuration | `PATCH /managedconfigurations/2/{configId}` | Body: `device_ids`. Only type `2` (workstations/servers) is documented. Configuration ID must come from a read of `GET /managedconfigurations/{type}`. | **verified** |
| Uninstall protection | `POST /devices/uninstall` | Documented, but removes endpoint protection. | **excluded by policy** |

## ThreatSync operations

Service prefix: `/rest/threatsync/management/v1/{accountId}`

Endpoint actions require `entityId`; Firebox actions may omit it. **Never derive `entityId` from an Endpoint Security device ID.**

| Operation | Method + path | Contract | Status |
|---|---|---|---|
| Incident action | `POST /incidents/{incidentId}/actions` | Body: `command` + `parameters`. Commands below. Optional `comment` is documented for the incident-linked form. | **verified** |
| Account action | `POST /actions` | Body: `command` + `parameters`. Optional `comment` is **not** documented for this form. | **verified** |
| Incident status | `PATCH /incidents/{incidentId}` | Body: `status` ∈ `new` \| `read` \| `closed`, optional `comment`. | **verified** |
| Batch transaction | `POST /v1/transact` | Documented inconsistently (path prefix disagrees between heading and example). No batch-size, atomicity, or rollback guarantee stated. | **unsupported** |
| Standalone comment create | — | No create/update/delete operation is established for comments. | **unsupported** |

### ThreatSync commands

| Command | Required parameters | Status |
|---|---|---|
| `isolate` | none | **verified** |
| `unIsolate` | none | **verified** |
| `killProcess` | `pid` or `md5` | **verified** |
| `quarantineFile` | `md5` | **verified** |
| `blockAddress` | `address` | **verified** |
| `unblockAddress` | `address` | **verified** |

## Result observation

| Operation family | Documented status path | Limit |
|---|---|---|
| Endpoint Security scan | `GET /tasks`, `GET /taskdetails/{type}/{taskId}`, `GET /tasks/{type}/{taskId}/jobs`, `GET /tasks/{type}/{taskId}/jobs/{jobId}/status`, `.../results` | Implemented: exact `dcheck-<requestId>` marker or the recorded `task_id`, then every job status on the first jobs page. Status mapping: `0,1,6` pending; `2` succeeded; `3,4,5,7` failed; anything else unreadable. Result pages are **not** fetched, so a completed task proves execution only. |
| Endpoint Security isolation / release / reboot | `GET /devices` and `GET /devicesprotectionstatus` expose isolation state, pending action flags, and reboot-requested state | Implemented for isolation/release only, and only for explicitly recognized isolation values; anything else is unreadable. `processed_device_ids` is an acceptance list, not proof the endpoint reached the requested state. Reboot has no verified completion read (manual review). |
| ThreatSync action | `GET /incidents/{incidentId}/actions/{actionId}`, `GET /incidents/{incidentId}/actions`, `GET /actions` | **Not implemented as an observation.** The per-action status read is not exercised, so every ThreatSync request moves to `needs_review` on first observation. The documentation does not enumerate the status enum. |

Consequences enforced in code:

- Provider acceptance is recorded as `in_progress`, never `completed`.
- `completed` requires a positive status read, not an inference from absence of error.
- Endpoint cleanliness is never inferred from a completed scan; result pages are not fetched and
  no clean/threat-free claim is produced.
- Closing a ThreatSync incident is not endpoint remediation and is recorded as a separate,
  explicitly labelled action.
- ThreatSync writes require a stored provider incident target. No ingestion writer exists in this
  repository, so those requests currently fail with `target_unresolved` instead of inventing an id.

## Actions excluded from the first release

| Action | Reason |
|---|---|
| Uninstall endpoint protection | Removes protection from the endpoint; no recovery path in this application. |
| Batch `/transact` | Documented inconsistently and with no atomicity contract. |
| Standalone comment | No documented create operation. |
| Repair / clean / generic remediation | No documented contract. |
| Automatic (no-approval) execution | Requires a separate design review; all writes are single-target, explicitly approved. |
| Bulk / multi-target writes | No bulk execution path is authorized. |

## Operation identity

Every write is identified by `(namespace, actionType)`:

- `endpoint_security` + `scan` | `isolate` | `unisolate` | `reboot` | `assign_config`
- `threatsync` + `ts_isolate` | `ts_unisolate` | `ts_kill_process` | `ts_quarantine` | `ts_block_ip` | `ts_unblock_ip` | `ts_incident_status`

A request carries exactly one target. Two targets means two requests, each approved separately.

## Pipeline infrastructure verification (2026-11-17 hardening pass)

The operation contracts above are unchanged. The execution pipeline around them was hardened and verified on
disposable PostgreSQL containers; no live provider call was made.

| Area | Verified behavior | Evidence |
|---|---|---|
| Reservation | One transaction locks the connection row (per-site mutex), reads LEAST(site, global) limits, counts committed dispatch attempts, claims via cooldown anti-join + FOR UPDATE SKIP LOCKED, commits the attempt row and its claimed event; HTTP stays outside the transaction | npm run test:epdr:postgres:integration — concurrent claims against cap=2 committed exactly 2 attempt rows for distinct actions |
| Attempt ledger | epdr_attempt_events is append-only at the DB level (UPDATE/DELETE rejected by trigger); claimed/sent/accepted/ambiguous/aborted/observed events recorded | check 41/41 incl. trigger rejection |
| Cooldown | A cooled-down endpoint+action pair cannot block other queue entries | check: anti-join skips cooled endpoint, claims the next one |
| Rate cap | Enforced from committed attempt rows, LEAST(site override, global ceiling) | check + integration |
| Approval expiry | Swept to cancelled with review_reason='approval_expired'; only lapsed requests | check + integration |
| ThreatSync targets | entity_id only from explicit provider fields; endpoint links require operator confirmation (review_state='confirmed' + matching account revision); detections never fall back to entity-as-device | provider-targets unit tests + confirmed-gating in execution-store |
| ThreatSync observation | Strict enum: getAction inProgress/performed only; ts_incident_status completes only on exact requested-status match; everything else unreadable -> bounded retry then needs_review | reconcile + client tests |
| Retention | Deletes only terminal-action attempts past the per-site window; redacts result/response; actions, snapshots and approvals permanent; idempotent | integration: deleted=1 then 0, result NULL |
| Monitoring | Worker heartbeat upsert (worker_id PK), /api/metrics epdr block, execution-health panel, compose healthcheck with exit-1 thresholds | check + component/action tests |
| CI | deploy.yml runs both isolated-PostgreSQL jobs (ubuntu-latest, Docker) and gates deploy on them | .github/workflows/deploy.yml |
