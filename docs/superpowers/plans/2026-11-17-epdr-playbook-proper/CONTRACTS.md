# Shared Local Review Contracts

These contracts are binding for T01–T04 and for the gated provider-execution path. They describe the current architecture and the only behavior authorized by this work package.

> **C1 note (2026-11-17).** A saved playbook version is still a simulate/local-review definition,
> and the local-review engine still emits no provider work. Real provider writes exist in a
> separate pipeline documented in C12–C15 and `RW_CAPABILITY_MATRIX.md`.

## C1 — Capability contract

A saved playbook version remains a **simulate/local-review definition**. It does not contain a provider task, free-form URL, dispatch mode, credential reference, notification target, or executable provider payload.

The operator-facing capabilities are:

| Capability | Allowed meaning |
|---|---|
| Local evidence | Persist detection/version evidence and immutable review facts |
| Analyst review | Record that an explicit local review was requested or completed |
| Incident handoff | Create an explicit DC incident through the existing handoff action |
| Local decision | Record an administrator decision without endpoint mutation |
| Provider action | Display as unavailable/suppressed in this work package |
| Notification | Display as disabled/not sent in this work package |

`PLAYBOOK_TEMPLATES` and local policy are advisory definitions. They never become dispatch authorization through this work package.

## C2 — Configuration and version identity

Use `playbookConfigSchema` from `lib/epdr/playbook-config.ts` as the only configuration contract.

A valid saved version has:

- `templateId` from the current catalog;
- a non-empty name;
- `mode: "simulate"`;
- bounded category/source/score filters;
- a server-stored configuration;
- an immutable definition containing the exact current template definition.

At review creation and recording, validate both the saved configuration and exact definition again. A changed catalog definition requires a new saved version. Never migrate or reinterpret an old definition silently.

## C3 — Site and revision isolation

Every server action must resolve the active site server-side through the existing admin/auth helpers. Client-provided site, account, endpoint, connection, version, and detection identifiers are untrusted lookup values until checked against that site and current binding.

Preserve the existing checks for:

- enabled WatchGuard connection;
- connection/account/credential revision;
- current endpoint identity and removal state;
- detection account revision and site;
- active-site administrator authorization;
- read-sync actor validation where the existing action already requires it.

A selector value is never an authorization decision.

## C4 — Detection and eligibility evidence

Eligibility is based on trusted saved evidence, not on visible labels or query strings. The evidence must continue to account for:

- known endpoint identity;
- source and category support;
- score validity and configured range;
- source-specific completeness and freshness;
- automation hold and unknown endpoint flags;
- exact template applicability;
- advisory response policy status.

A blocked recommendation remains blocked. A proposed recommendation is not permission to execute provider work.

## C5 — Local review state and actions

The authorized lifecycle is:

```text
pending → running → finished
```

- `pending`: a local review exists and explicit local outcome recording remains available.
- `running`: an operator explicitly claimed the local recording pass; no background worker is implied.
- `finished`: local evidence and local outcomes are recorded. It does not mean endpoint remediation, provider acceptance, or verified closure.

There are two distinct operator actions:

1. **Create local review** calls `startEpdrLocalPlaybook` with explicit local-review confirmation.
2. **Record local outcome** calls `resumeEpdrLocalPlaybook` only while the detail remains `pending`.

Opening a page, changing a URL, populating a selector, refreshing choices, or hydrating a component must not call either action.

## C6 — Immutable evidence and outcome recording

`startEpdrLocalPlaybook` must continue to write local run evidence, ordered steps, configuration, exact definition, detection evidence, response policy, site/account context, actor, and timestamp as already implemented.

`resumeEpdrLocalPlaybook` must retain lease/generation and CAS fencing. It must:

- claim only an eligible pending local run;
- stop if a stale generation loses the fence;
- never replay terminal outcomes;
- persist provider-shaped steps as suppressed, not executable;
- publish only local outcomes supported by `localStepOutcome`.

No provider task or notification may be created while recording local outcomes.

## C7 — Incident and approval boundaries

`IncidentHandoff` and `createEpdrIncidentHandoff` remain the only handoff path. Handoff requires explicit user confirmation and the existing server-side validation of detection, endpoint, site, assignee, PIC, asset, and linked incident.

`requestEpdrLocalApproval` may be used only with the existing proposed-policy and matching-template-step checks. Approval is a decision record. It must not:

- dispatch a provider action;
- change a run into remediation;
- mutate WatchGuard state;
- send a notification;
- unlock the read-only lock.

## C8 — Safe presentation and errors

User-facing copy must distinguish:

- local review created;
- local outcome recorded;
- provider action unavailable;
- notification disabled;
- handoff required;
- remediation not performed.

Action errors may use bounded categories such as `invalid_input`, `version_unavailable`, `detection_unavailable`, `binding_unavailable`, `version_definition_changed`, and `service_unavailable`. Map them to actionable UI text.

Do not send raw errors, SQL, provider payloads, stack traces, credential material, tokens, or internal paths to the client or add them to tests/docs.

## C9 — UI and data-state invariants

- Detection and version selectors use readable names and preserve selection state.
- Eligibility is displayed before create.
- Create and Record are separate controls.
- Record appears only while the current detail is `pending`.
- Incident handoff and local approval appear after the review context is available.
- Technical evidence remains collapsed/advanced.
- Loading, empty, stale, blocked, and error states are explicit.
- EN and ID copy are semantically aligned.

## C10 — Verification contract

Each ticket must add or update focused colocated tests for its changed behavior. Before hand-off:

- `npm run test`;
- `npm run typecheck`;
- `npm run lint`;
- `git diff --check`;
- translation parity review for changed UI;
- diff audit for prohibited provider/schema/worker changes.

Authenticated browser verification is optional evidence only when a valid local operator session exists. Otherwise report it as not performed.

## C11 — Change control and stop conditions

> **Superseded in part.** The operator explicitly authorized a gated provider-execution path
> (migration 0084; see the README scope supersession). Hand-written migrations, provider transport
> and background execution are in scope for that path only, under `READ_ONLY_SAFEGUARD.md` §0 and
> C12–C15. The stop conditions below continue to govern the local-review tickets.

Stop and report a blocker instead of improvising when:

- a local-review requirement appears to need schema or migration changes;
- a requirement would weaken site/revision isolation;
- a local-review requirement would require provider transport or background execution;
- an existing test must be deleted or weakened;
- current evidence cannot distinguish local completion from endpoint remediation;
- a translation or capability label cannot be expressed without claiming unsupported behavior.

Record the blocker in the ticket hand-off as a separate follow-up. Do not change this contract without explicit user authorization.
## C12 — Verified-operation registry

`lib/epdr/execution-capability.ts` is the single source of truth for what may be written.
An operation exists there only if `RW_CAPABILITY_MATRIX.md` records it as `verified`, together
with its exact method, path, receipt type, and parameter allowlist.

- Adding a value to `EPDR_ACTION_TYPES` does not enable it.
- `EXCLUDED_OPERATIONS` records what the provider documents but this application refuses:
  uninstall protection, `/transact`, standalone comments, repair.
- A stored request naming an unregistered operation is `snapshot_invalid`, never a best-effort send.

## C13 — Frozen snapshot and approval

`lib/epdr/execution-request.ts` defines the snapshot. `executionSnapshotHash` is a SHA-256 over a
canonical JSON form; `executionIntentKey` is the same identity without requester and expiry.

- The snapshotted parameters are validated against the operation's allowlist. Unknown keys are rejected.
- The snapshot binds site, connection, region, account, endpoint, device/entity/incident identifiers,
  namespace, action type, parameters, account revision, credential revision, evidence generation,
  requester, and expiry.
- Approval stores `approved_snapshot_hash`, which the database requires to equal `snapshot_hash`
  (`epdr_actions_approved_snapshot_check`).
- `approved_by <> requested_by` is enforced both in code and by
  `epdr_actions_no_self_approval_check`.
- Any material drift produces a new hash, so an older approval cannot authorize the new state.

## C14 — Write transport

`lib/watchguard/write-guard.ts` derives the method, host, and path from the registered operation.
A caller never supplies a URL. The guard requires, in order: enablement on, the RW credential pair,
a registered operation whose method and path still match the registry, a valid account id, a known
region, resolvable `{placeholder}` segments matching the path charset, and an exact segment-for-segment
template match.

`lib/watchguard/write-client.ts` performs a single attempt with no retry. It returns raw transport
facts; classification belongs to `lib/epdr/execution-dispatch.ts`.

The read-only guard in `lib/watchguard/guard.ts` is unchanged and continues to refuse every write.

## C15 — Dispatch, ambiguity, and observation

`lib/epdr/execution-engine.ts` fixes the control flow:

- `claim` commits the attempt row before any network I/O;
- `send` runs outside every transaction and exactly once;
- `finalize` publishes through a generation-checked CAS; a stale generation is `fenced`.

`lib/epdr/execution-dispatch.ts` classifies the result:

- `2xx` with the documented receipt → `accepted`;
- documented client rejections (`400, 401, 403, 404, 405, 409, 412, 415, 422, 429`) → `definite_reject`;
- timeout, network failure, `3xx`, `408`, `5xx`, or `2xx` without the receipt → `outcome_unknown`.

A stale dispatch lease becomes `outcome_unknown`; it is never treated as unsent.

`lib/epdr/execution-reconcile.ts` resolves ambiguity: exactly one match may be adopted, zero
matches stay unresolved, multiple or unreadable matches go to `needs_review`. Observation is
read-only and continues while a kill switch is active.

Status vocabulary is fixed: `pending_approval → queued → dispatching → in_progress →
completed | failed | needs_review`, with `outcome_unknown` as the ambiguous branch and `cancelled`
reachable only from `pending_approval` or `queued`. `completed` means the provider reported the
operation performed — never that the endpoint is clean.
