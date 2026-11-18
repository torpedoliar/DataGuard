# T02 — Version Authoring in the Main Review Workflow

**Depends on:** T01
**Status:** blocked (until T01 is done)
**Requirement trace:** R1, R2, R3, R6 (C2, C4, C8, C9)

## Goal

An administrator can author a named `simulate` version inside the main EPDR playbook review flow, and immediately use it as a review version — without hunting for an advanced/collapsed section.

## Problem being fixed

`saveEpdrPlaybookVersion` already exists in `actions/epdr-playbook-history.ts` and works correctly: it is admin-guarded, site-scoped, append-only, and validates the exact template definition. But the authoring form (`components/admin/epdr/playbook-history.tsx`) is separate from the runner, and a new version is not surfaced where the operator actually picks a version. As a result, a normal operator cannot start a local review at all.

This ticket closes that gap by making authoring part of the primary workflow and making version compatibility visible.

## Scope

In scope:

- Bring version authoring into the primary review flow (template, name, filters, explicit save).
- Show saved versions in the runner's version selector with template and version readable.
- Show why a version is or is not offered (compatible vs invalid configuration vs changed definition).
- Show the version's filters and template capabilities alongside the detection before review creation.
- Save a version must not create a run, incident, notification, or provider action.

Out of scope:

- Changing `saveEpdrPlaybookVersion` validation, locking, or the append-only rule.
- Any new action, endpoint, schema, or migration.
- Moving eligibility rendering into this ticket (that is T03's stage 3; this ticket only needs the version-side facts).
- Incident handoff and approval presentation (T04).

## Work items

1. Read `components/admin/epdr/playbook-history.tsx`, `components/admin/epdr/local-playbook-runner.tsx`, `actions/epdr-playbook-history.ts`, and `actions/epdr-local-playbooks.ts` (`getEpdrLocalPlaybookOptions` already filters versions by site + `mode = 'simulate'` + non-empty name + valid config + exact definition).
2. Surface a version-authoring form in the primary flow. Reuse `saveEpdrPlaybookVersion` and `playbookConfigSchema` inputs; do not add a second save path.
3. Make the form states honest:
   - disabled while pending;
   - `minScore > maxScore` or empty name blocks submit with an inline reason;
   - success message states "version saved", not "review started".
4. In the runner, render the version selector options from `getEpdrLocalPlaybookOptions` with name, version number, and template id, and show the selected version's filters (category/source/score range) plus its capability label from T01.
5. Explain unavailability: when `options.versions` is empty, state that no compatible version exists and that a version can be saved in this workflow. When a version the operator expects is missing, state the reason class (invalid configuration or template definition changed) without exposing internals.
6. Confirm that saving a version triggers no run/incident/notification: the save handler refreshes version data only.
7. Add or update component tests for:
   - saving a version refreshes the version list and does not create a run;
   - the version selector shows name/version/template;
   - a version with a changed definition is not offered as compatible and shows a safe recovery message;
   - filters are shown for the selected version.

## Files primarily touched

- `components/admin/epdr/playbook-history.tsx`
- `components/admin/epdr/local-playbook-runner.tsx`
- `actions/epdr-playbook-history.ts` (only if a read-side return type needs a small, non-breaking addition)
- `actions/epdr-local-playbooks.ts` (read-side only; no control-flow change)
- `app/[locale]/(dashboard)/admin/epdr/playbooks/page.tsx` (only if layout requires it)
- colocated tests

## Acceptance criteria

- [ ] An admin can choose a template, name a version, set filters, and save it without leaving the main review flow.
- [ ] The runner lists only site-scoped, compatible saved versions.
- [ ] Saving a version creates no run, incident, notification, or provider action.
- [ ] A version whose template definition changed shows a safe recovery message (save a new version) and is not selectable.
- [ ] Selected-version filters and capabilities are visible before review creation.
- [ ] No schema, migration, provider, credential, or worker change.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint` pass.

## Verification

- Focused: `npm run test` on the changed component/action tests
- Full: `npm run test`, `npm run typecheck`, `npm run lint`, `git diff --check`
- Optional: authenticated browser check only if a valid local operator session exists; otherwise report "Authenticated visual verification was not performed."

## Hand-off

- Files changed: components/admin/epdr/playbook-version-form.tsx (new, extracted shared form),
  components/admin/epdr/playbook-history.tsx (uses the form), components/admin/epdr/local-playbook-runner.tsx
  (inline form on no-compatible-version; onSaved refreshes choices and selects the new version),
  lib/epdr/playbook-version.ts (new shared classifier), actions/epdr-local-playbooks.ts (version metadata:
  filters, createdAt, compatibility reason, truncation flag).
- Tests added/changed and results: actions/epdr-local-playbooks.test.ts 52 passed (compatibility reasons now
  labeled instead of silently dropped), playbook-history.test.tsx 15 passed (form extracted; walker expands
  the nested form), local-playbook-runner.test.tsx inline-authoring cases passed.
- Confirmation that no schema, migration, provider, credential, or worker file changed: confirmed; read-side
  action and UI only.
- Blocked follow-ups (if any): none.
