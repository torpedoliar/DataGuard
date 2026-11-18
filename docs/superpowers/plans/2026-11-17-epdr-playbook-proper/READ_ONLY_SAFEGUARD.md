# Read-Only Safeguard

This document records the security boundary every agent must preserve. It is not a checklist to reinterpret. If a ticket appears to require crossing it, stop and report a blocker.

## 0. Scope supersession (2026-11-17)

The operator authorized a gated read/write execution path. The following clauses are **superseded** and must not be quoted as current policy:

| Superseded clause | Replacement |
|---|---|
| "No WatchGuard write operation" as an absolute rule | Writes are permitted **only** through `lib/watchguard/write-guard.ts` for operations listed as verified in `RW_CAPABILITY_MATRIX.md`, and only when both the deployment gate and the site gate are on. |
| "No provider transport" | A separate, allowlisted write transport exists at `lib/watchguard/write-client.ts`. It accepts a registered operation, never a URL. The read-only transport remains unchanged and still refuses every write. |
| "No schema changes" | Hand-written SQL migrations plus `meta/_journal.json` entries are permitted (0084 is the first). `drizzle-kit generate`/`push` and snapshot regeneration remain forbidden. |
| "No credential or configuration expansion" | The existing encrypted RW credential fields may be used. No new credential field, endpoint override, webhook, or notification channel may be added. |
| "No live probing" | Unchanged for automated work. Live activation requires the explicit operator checklist in `docs/runbook-watchguard-epdr.md` §11.8. |

**Unchanged and still absolute:**

- no uninstall of endpoint protection, no `/transact` batch, no standalone provider comment, no repair;
- no arbitrary HTTP executor — a caller can never supply a method, host, or path string;
- no automatic (no-approval) execution and no multi-target bulk sends;
- no bypass of site, revision, actor, or approval checks;
- no commit, push, deployment, active-database migration, or production activation by an agent;
- no credential value in code, fixtures, documents, logs, tickets, or chat.

## Absolute prohibitions

1. **No provider write outside the write guard.** Every write must pass `lib/watchguard/write-guard.ts` with a registered operation. No caller may supply a method, host, or path string.
2. **No second transport.** Do not add another provider client, fetch wrapper, SDK request, queue producer, or scheduler. Dispatch uses `lib/watchguard/write-client.ts`; observation uses the existing read client.
3. **No lock removal.** Do not weaken `classifyOutbound`/`assertWatchGuardRequest` in `lib/watchguard/guard.ts`, and do not add an environment or configuration switch that lets the read-only transport perform a write.
4. **No snapshot regeneration.** Hand-written SQL in `drizzle/` plus a `meta/_journal.json` entry only. Never run `drizzle-kit generate` or `drizzle-kit push`, and never rewrite an applied migration.
5. **No credential or configuration expansion.** Do not add credential fields, provider URL overrides, notification targets, webhook endpoints, or environment variables that enable execution.
6. **No live probing.** Do not call the WatchGuard API, CLI, or a live endpoint as part of automated work.
7. **No authorization bypass.** Do not weaken `requireActiveSiteAction`, `requireActiveSiteAdminAction`, `assertReadSyncActor`, or site/revision scoping.

## Invariants that must keep holding

- The only saved configuration mode is `simulate` (`playbookConfigSchema`).
- Local response policy output remains `scope: "local_review_recommendation"` with `providerLocked: true`, `notificationsEnabled: false`, `automationDelivered: false`, `operatorReviewRequired: true`.
- Provider-shaped steps stay inert and finish as `suppressed` with reason `provider_execution_disabled` (the engine's actual outcome; it is never `requires_operator`).
- Notification steps stay `suppressed` with reason `notifications_disabled`.
- No background process observes `epdr_local_playbook_runs`; recording happens only through an explicit `resumeEpdrLocalPlaybook` call.
- Lease, generation, and CAS conditions in `runLocalPlaybook` remain intact; a stale generation is reported as `fenced`, never forced.
- A saved version definition is immutable; a changed catalog definition yields a safe recovery message and requires a new version.
- Local approval records a second-administrator decision and never dispatches anything.
- Local review `finished` means local evidence is saved. It does not mean endpoint remediation, provider acceptance, notification delivery, or verified closure.
- A blocked or proposed recommendation is advisory. Neither is permission to mutate the provider.

Execution-path invariants (added with migration 0084):

- Both the deployment gate (`watchguard_global_settings.provider_writes_enabled`) and the site gate (`epdr_site_settings.provider_writes_enabled`) default to `false`, and an empty site action list allows nothing.
- A write always uses the RW credential pair; a resolved read pair is refused before any network I/O.
- A request can never be approved by the administrator who created it — enforced in code and by the `epdr_actions_no_self_approval_check` constraint.
- `approved_snapshot_hash` must equal `snapshot_hash`; any material change moves the request to `needs_review` instead of sending.
- The attempt row is committed before the provider request; a write is never retried.
- Timeout, network failure, 5xx, redirect, or a 2xx without the documented receipt field become `outcome_unknown`, and a stale dispatch lease becomes `outcome_unknown` — never "not sent".
- Observation performs reads only and continues while a kill switch is active.
- Provider acceptance is `in_progress`; `completed` means the provider reported the operation performed, not that the endpoint is clean.

## Evidence integrity rules

- Reuse the existing immutable evidence write path in `startEpdrLocalPlaybook`; do not create a parallel "simpler" path that skips eligibility, policy, revision, or actor capture.
- Do not relax exact template-definition comparison, `playbookConfigMatches`, or site/revision joins to make the UI easier.
- Do not render technical evidence as the primary operator narrative, and never expose credentials, tokens, SQL, or provider payloads.
- Do not delete or weaken an existing test to make a change pass. If a test encodes this boundary, keep it.

## Detection context rules

- URL parameters may carry `initialDetectionId` only, and only as a display preference.
- Mounting the runner, changing a URL, populating a selector, refreshing options, or clicking a history row must not create or resume a run.
- `startEpdrLocalPlaybook` and `resumeEpdrLocalPlaybook` require explicit, separately labelled operator confirmation.

## Stop-and-report conditions

Stop work and write a blocker note instead of proceeding when:

- a requirement cannot be met without a migration that the operator has not authorized;
- a requirement would need an operation that is not `verified` in `RW_CAPABILITY_MATRIX.md`;
- a requirement would need a notification sender, a `/transact` batch, or uninstall of protection;
- site, revision, or actor isolation would be weakened;
- local evidence cannot distinguish "local outcome recorded" from "endpoint changed";
- an existing safeguard test must be removed or loosened;
- a capability label cannot be phrased honestly without implying stronger execution than exists.

Report the blocker in the ticket's `## Hand-off` section and leave the security model unchanged.

## Definition of a safe change

A local-review change is safe when it only:

- improves labels, copy, layout, grouping, or disclosure of existing local-review capability;
- reuses existing actions and their validation;
- surfaces existing saved versions and eligibility evidence;
- adds or strengthens tests for existing behavior;
- keeps every local-review provider, notification, and worker boundary inert.

An execution change is safe when it additionally:

- routes every write through the registered operation + write guard, never through a caller-supplied URL;
- keeps both gates default-off and treats an empty action list as "nothing allowed";
- re-validates the full gate set at request, approval, and immediately before send;
- commits the attempt before the request and never retries a write;
- publishes ambiguity as `outcome_unknown` and leaves resolution to observation;
- adds or strengthens tests for each of the above.