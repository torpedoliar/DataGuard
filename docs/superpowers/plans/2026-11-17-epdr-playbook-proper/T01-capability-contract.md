# T01 — Capability and Terminology Contract

**Depends on:** none
**Status:** ready
**Requirement trace:** R6, R7 (C1, C5, C6, C7, C8)

## Goal

Make EPDR capability boundaries and status vocabulary explicit in the domain layer and in operator-facing copy, **without changing local-review runtime behavior**.

## Why this comes first

The runner, the policy engine, and the templates already encode the correct behavior. What is missing is a single explicit statement of what a local review can and cannot do. Every later ticket depends on that vocabulary being settled, otherwise T02–T04 would each invent their own labels.

## Scope

In scope:

- An explicit capability descriptor for the EPDR local review surface (which capabilities exist, which are inert).
- Terminology that separates: local review created / local outcome recorded / provider action unavailable / notification disabled / handoff required.
- Status and outcome copy that never implies remediation.
- Tests that pin these distinctions in the domain layer.

Out of scope (do not touch):

- `startEpdrLocalPlaybook` / `resumeEpdrLocalPlaybook` control flow, locking, or evidence shape.
- Provider transport, dispatch, workers, credentials, schema, migrations.
- Any change to `playbookConfigSchema` that would accept a mode other than `simulate`.

## Work items

1. Read `lib/epdr/playbook-config.ts`, `lib/epdr/local-response-policy.ts`, `lib/epdr/local-playbook-engine.ts`, `lib/epdr/playbooks.ts`, and the existing `lib/epdr/*.test.ts` files before writing anything.
2. Introduce a capability descriptor (a typed constant or small pure function) that states, for the local review surface:
   - `localEvidence: available`;
   - `analystReview: available`;
   - `incidentHandoff: available`;
   - `localDecision: available`;
   - `providerAction: unavailable` with reason `provider_execution_disabled`;
   - `notification: disabled` with reason `notifications_disabled`;
   - `automationDelivered: false`.
   Keep it derived from what the engine already returns; do not invent a second source of truth.
3. Pin the outcome vocabulary: `recorded`, `requires_operator`, `suppressed`, and the reasons `immutable_evidence_saved`, `explicit_admin_review_requested_not_resolved`, `use_explicit_local_incident_handoff`, `notifications_disabled`, `provider_execution_disabled`.
4. Pin the run status vocabulary: `pending`, `running`, `finished`, with an explicit note in code comments (and copy keys added in T03/T04) that `running` is an operator claim and `finished` is local evidence only.
5. Add focused tests in `lib/epdr/` covering:
   - `mode: "simulate"` is the only accepted saved configuration mode;
   - `evaluateLocalResponsePolicy` always returns `providerLocked: true`, `notificationsEnabled: false`, `automationDelivered: false`, `operatorReviewRequired: true`;
   - `localStepOutcome` for a provider step returns `requires_operator` + `provider_execution_disabled`;
   - `localStepOutcome` for a notify step returns `suppressed` + `notifications_disabled`;
   - a blocked policy never yields a proposed route.

## Files primarily touched

- `lib/epdr/playbook-config.ts`
- `lib/epdr/local-response-policy.ts`
- `lib/epdr/local-playbook-engine.ts`
- `lib/epdr/*.test.ts` (existing colocated tests; add new cases)

## Acceptance criteria

- [ ] The capability descriptor exists and is the single source used by UI in T03/T04.
- [ ] `simulate` remains the only saved configuration mode.
- [ ] Local response policy remains advisory and provider-locked.
- [ ] Provider and notify outcomes remain suppressed with their existing reasons.
- [ ] No provider transport, worker, dispatcher, schema, migration, or credential change.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint` pass.

## Verification

- Focused: `npm run test lib/epdr`
- Full: `npm run test`, `npm run typecheck`, `npm run lint`, `git diff --check`

## Hand-off

- Files changed: lib/epdr/local-capabilities.ts (new, client-safe), lib/epdr/local-capabilities.test.ts (new),
  actions/epdr-local-playbooks.ts (evidence capability fields replace the dead incidentPolicy), components/admin/epdr/playbook-catalog.tsx (per-step capability labels), components/admin/epdr/local-playbook-runner.tsx (step reason display).
- Tests added/changed and results: lib/epdr/local-capabilities.test.ts 6 passed (descriptor, per-step labels,
  simulate-only mode, locked advisory policy incl. blocked-no-route, provider/notify outcomes, plan steps).
  Full gate: 242 files / 2238 passed, typecheck clean, lint 0 errors.
- Confirmation that no schema, migration, provider, credential, or worker file changed: none of these were
  touched by T01 itself. (The same working session also carries 0085 for other phases; T01 introduced no
  schema/migration change.)
- Blocked follow-ups (if any): none.
