# T10 — Advanced actions (isolate, ThreatSync commands)

Depends on: T09 · Spec: §3.2, §5.3, §8, §13 phase 7 · Migration: none expected

## Goal

Add higher-impact responses as **approval-only** action types on the existing engine: endpoint isolation/release and the ThreatSync commands. None of them may run automatically in this ticket.

## Action types

| `action_type` | Provider call | Params (server-built) | Reversal |
|---|---|---|---|
| `isolate` | `isolateDevices({ device_ids, exclusion_programs?, customized_message?, hide_customized_alert })` | site default message | `unisolate` |
| `unisolate` | `unisolateDevices([id])` | — | — |
| `ts_kill_process` | ThreatSync `performIncidentAction(tsId, { command:'killProcess', entityId, parameters:{ md5 \| pid } })` | from the incident's `recommendedActions`/`threatDetails` only | none |
| `ts_quarantine` | `performIncidentAction(tsId, { command:'quarantineFile', entityId, parameters:{ md5 } })` | md5 from the incident | none via API |
| `ts_block_ip` | `performIncidentAction(tsId, { command:'blockAddress', parameters:{ address } })` | verified external address from incident data | `ts_unblock_ip` |
| `ts_unblock_ip` | `performIncidentAction(tsId, { command:'unblockAddress', parameters:{ address } })` | exact address/account from prior block, explicit approval | — |
| `assign_config` | Endpoint Security PATCH managedconfigurations/2/{configId} | existing configuration selected from verified account list and same-site endpoint | explicit later reassignment |

Rules:
- Each type must be present in global `allowed_actions`; `execution_mode` for rules using them is clamped to `approval` (policy + dispatcher).
- ThreatSync commands require a linked ThreatSync incident and an `entityId` taken from that incident; never constructed from inventory IDs (spec: entity ID semantics unverified).
- `ts_block_ip` approval screen states the blast radius: applies to all ThreatSync-enabled Fireboxes of the account, both directions.
- Verification: isolate/unisolate requires fresh same-target post-dispatch isolation state (2/3 remains progressing); assignment requires fresh matching config ID; ThreatSync commands use separate string status plus documented status/history/result. Success/terminal mappings need fixtures; unknown remains review. Provider acceptance is not incident remediation.
- C5 active endpoint command locks serialize conflicting isolation and rate reservations. IP actions target an account, not a fake device; model their verified incident/entity context explicitly. Block/unblock and isolation exception/message settings have approval preview and C8 UI controls.
- Proposals created by T08 (rescan still dirty, second reopen) and the manual "Request action" menu in the Incident panel.

## Acceptance

- [ ] No automatic dispatch possible for any type in this ticket (policy test + dispatcher test).
- [ ] Payloads built only from stored provider data; free-form input rejected.
- [ ] Isolation verification via sync state; ThreatSync verification via action status.
- [ ] Unisolate is offered on every isolated endpoint and audited.

## Tests

Dispatcher payload tests per type, policy clamp tests, verification mapping tests.

## Hand-off
