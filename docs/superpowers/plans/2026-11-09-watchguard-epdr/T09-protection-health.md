# T09 — Protection health ladder

Depends on: T08 · Spec: D6, §4.1, §4.2 · Migration: `NNNN_epdr_health_cases`

## Goal

Endpoints whose protection is Error, Install error, Disabled, or otherwise abnormal are tracked through an escalation ladder. The API has **no repair/reinstall endpoint** (spec §3.3); the ladder automates detection, reboot where it helps, escalation into Incidents for manual repair in the Console, and closure when health returns.

## Data model

```sql
CREATE TABLE epdr_health_cases (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  endpoint_id integer NOT NULL REFERENCES epdr_endpoints(id) ON DELETE CASCADE,
  problem text NOT NULL,          -- disabled | error | install_error | unknown_status | outdated | pending_restart
  stage integer NOT NULL DEFAULT 0,   -- 0 detected, 1 reboot, 2 repair protection, 3 repair agent
  opened_at timestamp NOT NULL, stage_changed_at timestamp NOT NULL,
  last_status jsonb NOT NULL,     -- protection fields snapshot
  incident_id integer REFERENCES incidents(id) ON DELETE SET NULL,
  reboot_action_id integer REFERENCES epdr_actions(id),
  healthy_since timestamp,
  closed_at timestamp, close_reason text
);
CREATE UNIQUE INDEX epdr_health_cases_open_idx ON epdr_health_cases (endpoint_id) WHERE closed_at IS NULL;

ALTER TABLE epdr_site_settings
  ADD COLUMN health_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN health_grace_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN health_stage_wait_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN health_reboot_mode text NOT NULL DEFAULT 'approval',   -- off | approval | automatic
  ADD COLUMN health_reboot_countdown integer NOT NULL DEFAULT 7,    -- API count_down_type, 7 = 8 hours
  ADD COLUMN health_stable_minutes integer NOT NULL DEFAULT 60;
```

## Classification (`lib/epdr/health.ts`, pure)

From the synced endpoint row:

| Problem | Condition |
|---|---|
| `disabled` | `accumulated_protection_status = 2` |
| `error` | `= 3` |
| `install_error` | `= 4` |
| `unknown_status` | value not in0–6 or unexpected schema; review, never assume Installing |
| `installing` | separate unmanaged-device status2; grace/timeout only, population distinct until verified |
| `pending_restart` | `protection_engine_update_status = 3` or `reboot_requested` |
| `outdated` | engine or knowledge catalog update status `= 1` |
| none | `= 1` and no flag above |

`5` (no license) and `0`/`6` are reported on the dashboard only; offline endpoints (`last_connection_at` > 3 days) never advance stages.

## Ladder (worker job `health`, runs after each endpoint sync)

```text
problem seen          → open case, stage 0
stage 0, grace passed, still problem
   explicit pending_restart / reboot_requested AND enabled reboot policy → stage 1: propose reboot action
        mode from health_reboot_mode; server/critical/no_auto forced to approval (golden rule 6)
   otherwise → stage 2
stage 1, reboot completed + stage_wait passed, still problem → stage 2
stage 2 → Incident "Repair protection required — <host>" (source epdr, severity High,
          Critical if server/critical), description: problem, module statuses,
          reinstall_protection_error {code, step, date}, Console path
          Computers › <host> › Repair protection
stage 2 + stage_wait passed, still problem, or reinstall_agent_requested/agent error
          → stage 3: same incident escalated (severity +1, note "Repair agent required",
          reinstall_agent_error details), notify
any stage, healthy (problem = none) for health_stable_minutes → close case;
          linked incident Resolved by system (resolution_action 'Reconfigured'), note
```

`outdated` alone opens a case at stage 0 and only escalates to an Incident (stage 2) after `stage_wait`; it never reboots. Reboot uses action type reboot from T07, but clearing reboot_requested alone never proves execution (C7). Record accepted-unverified; require adequate observed confirmation or manual verification; deadline without proof -> review. If reboot mode is off, proceed with diagnosis, not an implicit command. Reinstall flags indicate requested work, not a reboot instruction.

The desired repair protection -> repair agent sequence remains blocked_unsupported for automatic execution. UI shows that capability badge, explicit manual-repair task/confirmation and each attempt/result; auto-advance never fabricates a successful repair. Installing timeout goes to review. Disable/error classification respects expected modules, platform and assigned profile; intentional policy-disabled modules are not presumed broken. Stage2->3 requires recorded protection-repair outcome or a justified agent diagnosis. Add health-specific Incident/workflow kind so this ladder cannot close a threat or manual Incident. Hold, closure mode, stale data, server/critical policy and remaining work use T08/C6 guards.

UI/settings additions from C8: expected modules and standard profiles per platform/type, installing timeout, stage wait, health closure mode, maintenance window and manual confirmation. Profile drift may propose approval-only assign_config (implemented T10); never silently rewrite settings. For managed-disabled server/critical endpoint, create/notify High-or-higher health Incident immediately while preserving approval for responses.

## UI

- `/admin/epdr`: "Protection issues" table with stage, problem, age, linked Incident, reboot action state.
- `/admin/epdr/settings`: section "Protection health" with the settings above.
- Incident EPDR panel shows the health case timeline when the incident came from the ladder.

## Acceptance

- [ ] `classify` and ladder transitions are pure and table-tested, including grace, stage waits, offline freeze, recovery.
- [ ] One open case per endpoint; repeated syncs do not duplicate incidents or reboot actions.
- [ ] Server/critical reboot always needs approval.
- [ ] Stable, fresh verified recovery closes only its own eligible health case/Incident under configured closure policy; Hold/manual/mixed/threat cases stay open.
- [ ] Installing/unknown status, disabled-by-policy and reinstall flags do not produce unsafe reboot/repair; unsupported repair is visible in UI and handoff.
- [ ] No code path calls a repair/reinstall endpoint.

## Tests

`lib/epdr/health.test.ts`, health job idempotency with fake clock, settings action auth.

## Hand-off
