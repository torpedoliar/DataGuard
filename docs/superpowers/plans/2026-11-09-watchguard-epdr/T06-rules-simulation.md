# T06 — Response rules + simulation mode

Depends on: T05 · Spec: D3, D4, §5.2, §5.4, §8, §9.2 (4) · Migration: `NNNN_epdr_rules`

## Goal

Site admins define response rules in a form. Every new detection episode is evaluated; in this ticket every decision is only **recorded** (simulation), so the site can see what automation would do before anything is sent.

## Data model

```sql
CREATE TABLE epdr_rules (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  rule_key uuid NOT NULL,                 -- stable across versions
  version integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  trigger text NOT NULL,                  -- 'detection' (T06) | 'health' (T09)
  categories text[] NOT NULL DEFAULT '{}',
  min_score integer, max_score integer,
  device_types integer[] NOT NULL DEFAULT ARRAY[1,2],   -- workstation, laptop
  action_type text NOT NULL,              -- from lib/epdr/action-types.ts
  action_params jsonb NOT NULL DEFAULT '{}',            -- e.g. {"scanScope":0,"windowHours":24}
  execution_mode text NOT NULL DEFAULT 'simulate',      -- simulate | approval | automatic
  close_mode text NOT NULL DEFAULT 'manual',            -- auto | approval | manual
  observation_minutes integer NOT NULL DEFAULT 30,
  cooldown_minutes integer NOT NULL DEFAULT 240,
  priority integer NOT NULL DEFAULT 100,
  simulate_since timestamp,
  pending_mode text, pending_mode_requested_by integer REFERENCES users(id), pending_mode_requested_at timestamp,
  created_by integer REFERENCES users(id), created_at timestamp DEFAULT now(),
  UNIQUE (rule_key, version)
);
CREATE UNIQUE INDEX epdr_rules_current_idx ON epdr_rules (rule_key) WHERE is_current;

CREATE TABLE epdr_rule_evaluations (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  incident_id integer NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  endpoint_id integer REFERENCES epdr_endpoints(id) ON DELETE SET NULL,
  rule_id integer REFERENCES epdr_rules(id),          -- the exact version
  trigger_detection_id integer REFERENCES epdr_detections(id),
  decision text NOT NULL,     -- simulated | needs_approval | automatic | blocked | no_match
  effective_mode text,        -- after guardrails
  reasons jsonb NOT NULL,     -- ordered list of {code, detail}
  action_id integer,          -- set by T07 when an action is created
  created_at timestamp DEFAULT now(),
  UNIQUE (incident_id, rule_id, trigger_detection_id)
);
```

Editing a rule inserts a new version and flips `is_current`; history stays immutable.

## Policy (`lib/epdr/policy.ts`, pure)

`evaluate({ detection, endpoint, incident, rule, site, global, now, recentActions })` → `{ decision, effectiveMode, reasons }`. Order:

1. Match: rule enabled, trigger, category, score range, device type. Fail → `no_match`.
2. Blockers → `blocked`: global or site kill switch; action type not in global `allowed_actions`; incident `automation_hold`; endpoint `removed_at`; endpoint offline > 7 days; data stale (endpoint sync older than 3× interval); cooldown (same endpoint + action type within `cooldown_minutes`); active exclusion (T08).
3. For live modes, server, unknown type, critical endpoint/asset or no_auto requires approval (CONTRACTS C5). No asset link is allowed; unresolved target/site is blocked. A rule in simulate always returns simulated with the would-be guardrail decision recorded and creates no live proposal.
4. Mode: simulate -> simulated; approval -> needs_approval; automatic -> automatic or needs_approval. Breaker pause downgrades automatic to needs_approval; global/site kill switches hard-block dispatch and closure. Apply C5 consistently, not a different paused behavior per job.

Every reason is a code from one enum (`EPDR_REASON_CODES`) so the UI can translate it.

Highest-priority matching rule wins per incident and action type; others are recorded as `no_match`-shadowed reasons.

## Evaluation trigger

Worker job evaluate consumes a durable pending evaluation keyed by workflow + evidence_generation + rule version. Add these fields/unique constraint to epdr_rule_evaluations: a changed existing ThreatSync record must be evaluated, an unchanged re-poll must not. Temporary blocks (cooldown/stale/offline/paused) have next_evaluate_at and are reconsidered after recovery without generating duplicate commands. A rule's simulate history does not automatically replay into live actions on activation; activation boundary/replay follows C2.

## Mode change safety

- New rules start as simulate. Qualification counts actual enabled successful simulation/coverage time, not merely time since draft creation; disabled days or material scope changes do not qualify.
- Requesting automatic requires the global UI-configured simulation minimum (default7 days) and a different current site admin confirmation; never hard-code 7 as an uneditable business rule. Material changes to scope/action/close policy reset simulation qualification. Use conditional version/CAS checks so stale confirmations cannot activate a changed rule. Approval mode needs no second mode-activation admin; individual commands still use distinct approval.
- Both steps audited.

## UI (`/admin/epdr/settings`, section "Rules")

- Rule list with mode badges, version, last match.
- Add source/source-score-presence fields to schema and UI. Seed two disabled simulation templates: Activity Malware/PUP/Exploit, score not required -> FULL scan; Scored IOA/Malware/PUP/Virus/Exploit 7–10 -> FULL scan. Configure independent close modes (default review for Critical/IOA/Exploit) within global closure ceiling. Expose all C8 rule settings, including group/endpoint allowlist, scan options/expiry, approval expiry, per-site cap, rescan limit and observation; display effective-policy reasons.
- Pending mode change banner with Confirm / Reject for other admins.
- Simulation report: per rule, last 7/30 days — would-dispatch count, forced-approval count, blocked by reason, top endpoints.

## Acceptance

- [ ] `evaluate` is pure and covered for every reason code.
- [ ] Server, critical, and `no_auto` endpoints never get `automatic`.
- [ ] Rule edits create versions; evaluations reference the version in force.
- [ ] Automatic activation obeys current global minimum and independent admin confirmation; stale rule revisions cannot be confirmed. Simulation on server/critical never creates live approval/actions.
- [ ] No provider write in this ticket.

## Tests

`lib/epdr/policy.test.ts` (table-driven matrix), `actions/epdr-rules.test.ts` (versioning, two-admin confirmation, self-confirm rejected, site isolation), evaluation job idempotency.

## Hand-off
