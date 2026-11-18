# Requirements Traceability

## R1 — Make the operator journey coherent

**Requested outcome:** an operator should understand that EPDR is a local review workflow, not a hidden endpoint-automation engine.

**Requirements:**

- Present the workflow as four readable stages: detection, version, eligibility, and outcome.
- Use operational labels rather than requiring internal numeric IDs.
- Keep the current URL detection handoff, but treat it only as initial context.
- Preserve the distinction between local review, incident handoff, and local decision.

**Tickets:** T02, T03

**Acceptance evidence:**

- component tests show the intended stage order and readable selectors;
- opening a URL carrying the detection context performs no mutation;
- the review detail displays the selected detection and saved review context.

## R2 — Make compatible versions authorable in the main workflow

**Requested outcome:** administrators must not need to discover an advanced section merely to create a version that the runner can use.

**Requirements:**

- Reuse `saveEpdrPlaybookVersion` and its exact simulate configuration validation.
- Provide template, version name, and bounded filter controls in the primary review workflow.
- After an explicit save, make the saved version available to the runner.
- Show only site-scoped versions with valid configuration and an exact current template definition.
- Do not turn catalog cards into an apparent executable action.

**Tickets:** T02

**Acceptance evidence:**

- an explicit save creates a version and no local run;
- a saved version appears in the version selector after refresh;
- a changed template definition produces a safe recovery message and does not silently reuse old evidence;
- invalid or incomplete configuration is rejected by the existing server action.

## R3 — Explain eligibility before review creation

**Requested outcome:** operators should not press Start when the UI has not explained why the detection is eligible or blocked.

**Requirements:**

- Display saved eligibility evidence before review creation.
- Explain missing identity, stale or incomplete evidence, filter mismatch, hold, unknown flags, and unsupported templates in operator-readable language.
- Revalidate eligibility and target/version bindings in the server action; selector display is not authorization.
- Preserve blocked behavior when evidence is insufficient.

**Tickets:** T02, T03

**Acceptance evidence:**

- eligible, blocked, and review-required states are distinguishable;
- blocked evidence cannot be bypassed by changing selectors;
- server-side tests cover the same safety boundaries.

## R4 — Separate review creation from outcome recording

**Requested outcome:** creating a local review and recording the outcome must be intentional, separate acts.

**Requirements:**

- Start/Create creates only the durable local run and immutable review evidence.
- Record is offered only for a run in `pending` status.
- Record uses `resumeEpdrLocalPlaybook`; it must not replay terminal outcomes or run automatically on mount.
- `running` means an operator has explicitly claimed the recording pass.
- `finished` means local outcomes are recorded, not remediation.

**Tickets:** T03

**Acceptance evidence:**

- two explicit clicks are required for create and record;
- no resume button appears for `finished`;
- status text says local review saved rather than resolved/remediated;
- tests cover stale and out-of-order responses.

## R5 — Preserve explicit incident and approval destinations

**Requested outcome:** after a review, operators should know where to send the work without creating incidents or decisions implicitly.

**Requirements:**

- Keep `IncidentHandoff` as an explicit action with valid detection context.
- Keep local approval available only for the saved proposed policy and matching template step.
- Approval records an administrator decision only; it cannot unlock provider work.
- Show decision-only language consistently.

**Tickets:** T03, T04

**Acceptance evidence:**

- no handoff/approval mutation occurs during review loading or recording;
- approvals cannot be requested for blocked policies or unsupported intents;
- UI and tests state that provider execution remains read-only.

## R6 — Make capability and failure language honest

**Requested outcome:** the UI should not imply scan, isolation, notification, containment, or remediation when the local workflow did not perform those actions.

**Requirements:**

- Add aligned capability and status labels in EN and ID.
- Provider/notify outcomes remain suppressed with safe reasons.
- Technical evidence remains collapsed by default.
- Errors are bounded and actionable without raw provider/SQL/credential exposure.
- EN and ID translation keys and meanings stay aligned.

**Tickets:** T01, T03, T04

**Acceptance evidence:**

- translation parity checks pass;
- component tests verify capability notices and safe errors;
- review diff contains no secret or raw exception logging.

## R7 — Keep the security and persistence boundary intact

**Requested outcome:** local review and provider execution must never become an uncontrolled bypass.

**Requirements:**

- All schema changes are hand-written SQL plus a journal entry; snapshots are never regenerated.
- The read-only transport keeps refusing every write; writes use the separate, narrower write guard.
- Execution is gated by a deployment flag, a site flag, a global ceiling, and a per-site allowlist — all default off.
- A write requires a different currently-authorized site administrator, an unexpired approval, and an exact snapshot match re-checked immediately before send.
- Site/account/credential revision validation, immutable evidence, and lease/generation/CAS safeguards are preserved.
- No seed production data, no live WatchGuard commands, no production activation by an agent.

**Tickets:** T01, T02, T03, T04 (local review); RW pipeline (`RW_CAPABILITY_MATRIX.md`, migration 0084)

**Acceptance evidence:**

- diff audit shows the read-only guard and its tests unchanged;
- tests confirm an unverified operation, a disabled gate, a read credential pair, self-approval, an expired approval, and a changed snapshot are all refused;
- tests confirm a write is attempted once and ambiguity never triggers a resend;
- any needed capability the provider does not document is reported as unsupported, not implemented.

## Explicit non-requirements

The following are not part of this work package:

- uninstall of endpoint protection;
- `/transact` batch submission;
- standalone provider comment creation;
- repair / clean / generic remediation;
- automatic (no-approval) execution;
- multi-target or bulk sends;
- notification delivery to external channels;
- provider incident/comment synchronization beyond the documented status PATCH;
- Drizzle snapshot regeneration;
- production configuration, credential use, or live provider calls by an agent.

These capabilities require a separately reviewed design, explicit authorization, and their own security and acceptance plan.