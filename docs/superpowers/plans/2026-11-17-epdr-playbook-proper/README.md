# EPDR Playbook Proper — Agent Execution Work Package

Status: **gated RW execution hardened; local-review tickets T01–T04 still pending** · Date: **2026-11-17**

> **Scope supersession (2026-11-17).** This package originally authorized a
> local-review-only change and explicitly forbade provider writes. The operator
> has since authorized a gated read/write execution path. `READ_ONLY_SAFEGUARD.md`
> §0 records exactly which clauses were superseded and which invariants remain
> binding. The read-only transport in `lib/watchguard/guard.ts` is unchanged;
> writes travel through the separate, narrower `lib/watchguard/write-guard.ts`.
> See `RW_CAPABILITY_MATRIX.md` for the verified operations and
> `PROGRESS.md` for the verification log.

## Purpose

This work package defines how to make the EPDR playbook operable as a clear, evidence-backed **local review workflow**. The current implementation already contains local runs, saved simulation versions, immutable evidence, explicit incident handoff, and local approvals. The remaining problem is usability and conceptual clarity: version authoring is hidden in advanced tooling, the UI uses ambiguous execution language, and operators cannot easily distinguish local review completion from endpoint remediation.

The intended outcome is a four-stage operator journey:

```text
Choose detection
→ Choose or save a compatible review version
→ Inspect eligibility and capability limits
→ Create a local review and explicitly record its outcome
```

Incident handoff and local decisions remain separate explicit actions after the review.

## Authorization boundary

This work package authorizes application-code and documentation changes for a
proper local-review workflow **and** a gated provider-execution path.

Local review still does **not** authorize:

- treating a saved response policy or local approval as execution authorization;
- claiming that a finished local review resolved, contained, or remediated a threat.

Provider execution is authorized **only** through the execution pipeline, and only when all of
the following hold at request time, again at approval time, and again immediately before send:

- the deployment gate and the site gate are both on;
- the action is in the global ceiling **and** the site allowlist;
- the operation has a verified contract in `RW_CAPABILITY_MATRIX.md`;
- a read-write credential is stored and the binding revisions are unchanged;
- a second, different, currently-authorized site administrator approved the exact snapshot;
- the approval has not expired and the snapshot still matches fresh state.

Still not authorized anywhere in this repository:

- uninstall of endpoint protection, `/transact` batch sends, standalone provider comments, or repair;
- automatic (no-approval) execution and multi-target bulk sends;
- an arbitrary HTTP executor, or any provider URL that is not built by the write guard;
- schema changes outside hand-written migrations, or regenerating Drizzle snapshots;
- live API probes, production credential use, production activation, or applying migrations.

If an implementation need cannot be satisfied within this boundary, stop and record it as a blocked follow-up in the ticket hand-off.

## Binding references

Read these before implementation:

1. [READ_ONLY_SAFEGUARD.md](READ_ONLY_SAFEGUARD.md)
2. [REQUIREMENTS.md](REQUIREMENTS.md)
3. [CONTRACTS.md](CONTRACTS.md)
4. The assigned ticket in dependency order.
5. Repository instructions in `AGENTS.md`.
6. Existing EPDR contracts in [../2026-11-09-watchguard-epdr/CONTRACTS.md](../2026-11-09-watchguard-epdr/CONTRACTS.md).

The existing EPDR plan remains authoritative for the historical integration design. This document is authoritative for the local-review usability and execution scope described here. If the two conflict, stop and report the conflict rather than weakening the read-only safeguard.

## Current implementation to reuse

Do not replace working safeguards with a parallel workflow.

### Detection and eligibility

- `actions/epdr-local-playbooks.ts` provides bounded, site-scoped option loading, local-run creation, run lookup, and explicit local recording.
- `actions/epdr-playbooks.ts` provides read-only detection preview and eligibility evidence.
- `lib/epdr/playbooks.ts` owns catalog templates, filtering, freshness, and evaluation.
- `lib/epdr/local-response-policy.ts` produces advisory policy only.

### Version authoring and history

- `actions/epdr-playbook-history.ts` owns `saveEpdrPlaybookVersion`, simulation recording, and site-scoped history.
- `lib/epdr/playbook-config.ts` enforces the simulate-only, exact configuration contract.
- `components/admin/epdr/playbook-history.tsx` contains the existing version-creation form.

### Local review and outcome recording

- `components/admin/epdr/local-playbook-runner.tsx` owns the operator workflow.
- `lib/epdr/local-playbook-engine.ts` owns local plans, ordered steps, and inert provider/notification outcomes.
- `resumeEpdrLocalPlaybook` is the explicit local outcome-recording action.

### Handoff and approval

- `actions/epdr-incident-handoff.ts` and `components/admin/epdr/incident-handoff.tsx` own explicit incident handoff.
- `actions/epdr-local-approvals.ts` and `components/admin/epdr/local-approvals.tsx` own decision-only local approvals.

## Ticket sequence

| # | Ticket | Depends on | Status | Completion boundary |
|---|---|---|---|---|
| T01 | [Capability and terminology contract](T01-capability-contract.md) | — | pending | Capability labels and vocabulary are explicit; local engine behavior stays unchanged |
| T02 | [Version authoring in the main review flow](T02-version-authoring.md) | T01 | blocked | A valid version can be saved and selected without advanced tools |
| T03 | [Four-stage local review workflow](T03-local-review-workflow.md) | T02 | blocked | Detection, eligibility, create, and record are understandable and explicitly separated |
| T04 | [Handoff, approval, translations, and release verification](T04-handoff-approval-verification.md) | T03 | blocked | Operator journey, EN/ID copy, tests, and hand-off evidence are complete |

Work tickets sequentially unless a dependency-free test or documentation task is explicitly assigned. One owner should merge shared translation or presentation-contract changes to avoid conflicting edits.

## Golden rules

1. **Read-only detection context.** A detection ID in a URL or selector is context only. Page load, mount, hydration, URL changes, and option refresh must not create, resume, approve, hand off, or execute anything.
2. **Explicit local actions.** Creating a review and recording its outcome require separate, intentional user actions.
3. **Compatible versions only.** The runner may select only saved, site-scoped `simulate` versions whose configuration validates and whose definition exactly matches the current catalog template.
4. **Immutable evidence.** Do not reinterpret a saved template definition. If the current definition differs, require a new saved version.
5. **Policy is not permission.** `proposed` and `blocked` are saved recommendations. Neither authorizes provider execution. A local approval never becomes an execution approval.
6. **Provider steps remain inert in local review.** Scan, isolation, notification, and provider-shaped steps stay suppressed with safe reasons such as `provider_execution_disabled` or `notifications_disabled`. Real provider writes exist only in the separate execution pipeline.
7. **Local completion is not remediation.** `finished` means local review evidence and outcomes were recorded. It never means an endpoint was scanned, isolated, cleaned, or protected. The same rule applies to an execution request in `completed`: it means the provider reported the operation performed, not that the endpoint is clean.
8. **Site and revision isolation.** Every query and mutation resolves the active site server-side and validates the current connection/account/credential context already required by the existing actions.
9. **Safe errors.** Return bounded error categories and actionable UI text. Do not expose raw exceptions, SQL, provider responses, credentials, tokens, or stack traces.
10. **No schema workaround.** All schema changes are hand-written SQL in `drizzle/` plus a
    `meta/_journal.json` entry. Never run `drizzle-kit generate`/`push`, and never regenerate the
    stale snapshot chain. If data shape is insufficient, report a blocked follow-up.
11. **Aligned languages.** Every new user-facing EN string needs an ID counterpart with equivalent meaning.
12. **No live validation.** Tests use fixtures and mocked actions. Do not send requests to WatchGuard or use production credentials.

Execution-specific rules:

13. **One attempt per write.** A write is never retried. Timeout, 5xx, redirect, or a 2xx without
    the documented receipt field become `outcome_unknown`; only observation resolves them.
14. **Approval is a different administrator's decision on a frozen snapshot.** Any change to
    target, parameters, account/credential revision, or evidence generation invalidates it.

## Agent execution protocol

For each ticket:

1. Confirm all dependencies are `done` in the ticket table.
2. Read this README, REQUIREMENTS, CONTRACTS, READ_ONLY_SAFEGUARD, and the assigned ticket.
3. Implement only the assigned scope and reuse the existing actions/utilities above.
4. Add or update colocated Vitest tests for changed behavior.
5. Run focused tests first, then the complete required verification.
6. Record changed files, tests, deviations, blocked work, and browser-verification status in the ticket's `## Hand-off` section.
7. Update the ticket row in this README and its ticket status.
8. Do not commit or push unless the user explicitly asks after delivery.

## Required verification

Before marking any ticket `done`:

- affected Vitest files pass;
- `npm run test` passes;
- `npm run typecheck` passes;
- `npm run lint` passes;
- `git diff --check` passes;
- EN and ID translation key sets match for changed UI;
- diff review confirms no schema/migration/provider/worker/transport changes;
- no credential or sensitive runtime value appears in code, tests, logs, or documents.

For authenticated browser verification, use only a valid local operator session and local data. If access stops at login or no valid session exists, state clearly: **Authenticated visual verification was not performed.** Do not claim runtime reproduction from a screenshot or URL alone.

## Definition of done

The local-review work package is complete when an agent can follow the four tickets and deliver:

- inline or otherwise discoverable version authoring;
- a readable detection-to-outcome review flow;
- eligibility and capability boundaries visible before action;
- explicit create/record separation;
- incident and approval shown as separate destinations;
- safe, actionable error and empty states;
- aligned EN/ID language;
- green application verification within the stated security boundary.

The provider-execution path is complete when request → approval → dispatch → observation is
connected end to end in code, every enabled operation has a verified contract and a typed
adapter, exact-target immutability is re-derived and hash-checked at approval and dispatch, and no
write can occur while either gate is off. Operations whose completion cannot be read back must
say so and end in `needs_review`. Real-world activation remains a separate, explicitly authorized
step documented in `docs/runbook-watchguard-epdr.md` §11.