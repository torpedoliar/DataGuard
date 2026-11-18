# T03 — Four-Stage Local Review Workflow

**Depends on:** T02
**Status:** blocked
**Requirement trace:** R1, R3, R4, R6, R7 (C4, C5, C6, C8, C9)

## Goal

The runner reads as four explicit stages — **Detection → Version → Eligibility → Local outcome** — where creating a local review and recording its outcome are separate, individually confirmed actions.

## Problem being fixed

Today the runner mixes everything: a four-item strip, two selectors, a confirm checkbox, one "start" button, a conditional "resume" button, a policy block, steps, raw JSON, incident handoff, and approval buttons. The operator cannot tell what happened, what is pending, or what a finished state means. Eligibility is only visible after a review exists.

## Scope

In scope:

- Restructure the runner into four labelled stages with clear current-stage indication.
- Show eligibility and capability limits before review creation.
- Rename/behave the primary button as explicit local-review creation.
- Show Record only while the run is `pending`.
- Explain `running` as an operator claim, and `finished` as local evidence saved (not remediation).
- Read `initialDetectionId` as display-only; never dispatch from page/search params or mount.
- Guard against stale responses and unmount overwriting current state.
- Map errors to safe, actionable messages.

Out of scope:

- Incident handoff and local approval UI details (T04 keeps them, wires copy).
- New actions, new tables, new evidence fields.
- Changing `resumeEpdrLocalPlaybook`'s lease/generation/CAS behavior.

## Four stages

1. **Choose detection** — site-scoped detections from `getEpdrLocalPlaybookOptions`, with host, threat, category, score, and observed time. URL `initialDetectionId` preselects for display only.
2. **Choose version** — compatible saved versions (T02), with template, version, and filters visible.
3. **Inspect eligibility** — render `evidence.eligibility` and `evidence.responsePolicy` from the saved recommendation *before* create is offered:
   - eligible / blocked reasons in plain language;
   - the advisory notice: a proposed recommendation is not permission to act on the endpoint;
   - the capability notice from T01 (local evidence, analyst review, incident handoff, local decision available; provider unavailable; notifications disabled).
4. **Create local review, then record outcome** — two separate confirmations:
   - Create calls `startEpdrLocalPlaybook` with `mode: "local"` and `confirmLocalReview: true`; feedback distinguishes "existing review found" from "local review created".
   - Record appears only while detail status is `pending` and calls `resumeEpdrLocalPlaybook`; feedback uses `resume_finished` / `resume_busy_or_finished` / `resume_fenced`.

## Work items

1. Keep `mounted` / `detailRequest` guards (or equivalent) so an in-flight detail request cannot overwrite a newer selection or post-unmount state.
2. Stage indicator: highlight the stage the operator is on; mark completed stages without implying remediation.
3. Pre-create eligibility block driven by selected detection + version facts already loaded from options. If a fact is missing, say it is unavailable rather than assuming eligible.
4. Replace the single primary action with a clearly labelled create action; require the existing confirm checkbox; keep the button disabled until detection, version, and confirmation are present.
5. Record control: separate button, `disabled` while pending transition, rendered only for `status === "pending"`; after recording, refresh detail and history.
6. Status copy:
   - `pending`: local review created; local outcome not yet recorded.
   - `running`: an operator is recording local outcomes; no background worker.
   - `finished`: local evidence and outcomes are saved; no endpoint remediation, provider acceptance, or notification delivery occurred.
7. Keep technical evidence collapsed under `<details>`; never surface raw JSON as the primary narrative.
8. Errors: `invalid_input`, `version_unavailable`, `detection_unavailable`, `binding_unavailable`, `service_unavailable` map to actionable text; never show raw messages, SQL, or provider payloads.
9. Add/update component tests for:
   - mount and URL change do not call start or resume;
   - create and record are separate controls with separate confirmations;
   - Record is hidden for a non-pending detail;
   - stale detail responses cannot overwrite a newer request;
   - eligibility reasons render before create;
   - status copy never claims remediation.

## Files primarily touched

- `components/admin/epdr/local-playbook-runner.tsx`
- `components/admin/epdr/playbook-history.tsx` only if a shared presentation helper is genuinely shared
- colocated tests
- `messages/en.json` / `messages/id.json` additions are allowed only for new stage/status copy keys; keep both files in parity (full copy pass is T04)

## Acceptance criteria

- [ ] Four stages are explicit and the current stage is visible.
- [ ] Eligibility and capability limits are readable before review creation.
- [ ] Create and Record are separate, individually confirmed actions.
- [ ] Record appears only while the run is `pending`.
- [ ] `running` and `finished` copy never imply a worker or remediation.
- [ ] URL detection context is read-only; no action is dispatched from page/search params or on mount.
- [ ] Stale responses and unmounts cannot overwrite current state.
- [ ] Technical evidence remains collapsed/advanced.
- [ ] No schema, migration, provider, credential, or worker change.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint` pass.

## Verification

- Focused: `npm run test` on runner tests
- Full: `npm run test`, `npm run typecheck`, `npm run lint`, `git diff --check`
- Translation check: any new key exists in both `messages/en.json` and `messages/id.json`

## Hand-off

- Files changed: actions/epdr-local-playbooks.ts (eligibility via the extracted loadLocalReviewContext/
  buildLocalSignal shared with the start path; LocalPlaybookError gains the three actionable codes),
  components/admin/epdr/local-playbook-runner.tsx (aria-current 4-stage indicator, pre-create eligibility
  panel, stale-selection membership guard, error mapping).
- Tests added/changed and results: local-playbook-runner.test.tsx 25 passed (eligibility before create with
  no mutation, blocker display, stage semantics, stale-selection cleared after refresh, error codes mapped).
- Confirmation that no schema, migration, provider, credential, or worker file changed: confirmed.
- Blocked follow-ups (if any): none.
