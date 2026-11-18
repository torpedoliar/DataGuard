# T04 — Handoff, Approval, Translations, and Release Verification

**Depends on:** T03
**Status:** blocked
**Requirement trace:** R5, R6, R7 (C7, C8, C9, C10)

## Goal

Complete the operator journey: incident handoff and local approval remain explicit, clearly bounded destinations, EN/ID copy is aligned, and the whole package is verified as safe and coherent.

## Scope

In scope:

- Incident handoff presented as an explicit next action with valid review context.
- Local approval presented as a recorded decision only.
- Full EN/ID translation pass for every key added or changed in T01–T03.
- Final release verification: tests, typecheck, lint, whitespace, diff audit, translation parity.

Out of scope:

- Any behavior that would let approval or handoff enable provider execution, notifications, or remediation.
- New approval semantics or a second approval path.
- Schema, migration, provider, credential, or worker change.

## Work items

1. **Incident handoff.** Keep `IncidentHandoff` / `createEpdrIncidentHandoff` as the only path. Ensure it requires an explicit operator click and valid review context (detection, site, endpoint, assignee, PIC, asset, linked incident). Copy must state that handoff creates a DC incident and does not change the endpoint.
2. **Local approval.** Keep `requestEpdrLocalApproval` with existing proposed-policy and matching-template-step checks. Copy must state that approval records a decision and does not dispatch, notify, or remediate. Approval buttons appear only when the saved recommendation is `proposed` and the template includes that intent — the existing behavior — and must be disabled while a transition is pending.
3. **Boundary copy.** Every destination states what it does and does not do:
   - handoff → creates a DC incident, no endpoint change;
   - approval → records a decision, no dispatch, no notification;
   - finished local review → local evidence saved, no remediation.
4. **Translations.** Reconcile `messages/en.json` and `messages/id.json` under the `Epdr` namespace for every key used by the runner, version authoring, handoff, and approvals. Semantics must match; ID must not be a literal English fallback. Verify no key is missing on either side and no orphaned key is left behind.
5. **Advanced evidence.** Keep raw JSON under `<details>`, labelled as technical evidence, secondary to the operator narrative.
6. **Accessibility and states.** Verify loading, empty, stale, blocked, and error states are explicit and keyboard reachable; selects keep labels; buttons have discernible text.
7. **Release verification.**
   - `npm run test` (full suite green)
   - `npm run typecheck`
   - `npm run lint`
   - `git diff --check`
   - translation key parity for the `Epdr` namespace
   - diff audit confirming no change to: `db/schema.ts`, `drizzle/`, migrations, `WATCHGUARD_READ_ONLY_LOCK`, `providerExecutionDecision`, provider transport, credentials, worker/dispatcher
   - no credentials, tokens, SQL, or provider payloads in code, tests, or logs
8. **Browser verification (conditional).** Only if a valid authenticated local operator session exists: walk the four stages and both destinations. Otherwise state exactly: "Authenticated visual verification was not performed." Do not fabricate a session or bypass login.

## Files primarily touched

- `components/admin/epdr/local-playbook-runner.tsx`
- `components/admin/epdr/local-approvals.tsx`
- `components/admin/epdr/incident-handoff.tsx`
- `messages/en.json`
- `messages/id.json`
- colocated tests

## Acceptance criteria

- [ ] Incident handoff requires an explicit click and valid review context, and states it does not change the endpoint.
- [ ] Local approval only records a decision and cannot enable provider execution or notifications.
- [ ] EN/ID keys and semantics stay aligned for all changed UI.
- [ ] Technical evidence remains collapsible and secondary.
- [ ] All affected tests plus the full Vitest suite pass.
- [ ] `npm run typecheck` and `npm run lint` pass.
- [ ] `git diff --check` clean.
- [ ] Diff audit confirms no schema, migration, provider, credential, or worker change.
- [ ] Browser verification either performed with a valid session or reported as not performed.

## Verification

- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- Translation parity check for the `Epdr` namespace
- Diff audit against the prohibited-change list

## Hand-off

- Files changed: messages/en.json, messages/id.json (new keys + stale copy fixes), components/admin/epdr/
  incident-handoff.tsx (new vs existing linked incident, boundary copy, status link), playbook history/runner
  copy re-points.
- Tests added/changed and results: all component tests green after the copy pass; EN/ID parity 0 mismatched
  keys in both directions; full gate 2238 passed.
- Confirmation that no schema, migration, provider, credential, or worker file changed: confirmed.
- Blocked follow-ups (if any): authenticated visual verification was not performed (no operator session
  available in this environment).
