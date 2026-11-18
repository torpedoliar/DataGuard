/**
 * Durable dispatch and observation orchestration.
 *
 * Pure control flow with injected side effects. The shape mirrors
 * `local-playbook-engine.ts`: a claim transaction fences ownership, the
 * network call happens *outside* any transaction, and the result is published
 * through a generation-checked CAS. The engine itself never sends a request
 * and never opens a database connection.
 *
 * Invariants enforced here rather than by convention:
 * - the attempt row is committed by `claim` before `send` runs;
 * - a stale generation cannot publish, so two workers can never both finalize;
 * - an ambiguous result is published as `outcome_unknown`, never as a failure
 *   that would allow an automatic retry;
 * - observation never sends a write.
 */
import type { DispatchClassification } from "./execution-dispatch";
import type { ObservationDecision } from "./execution-reconcile";

export type ClaimedDispatch = {
  actionId: number;
  generation: number;
  attemptNumber: number;
  /** Kept opaque here; the dispatcher builds the provider body from it. */
  snapshotHash: string;
};

export type DispatchRunResult =
  | { result: "sent" }
  | { result: "definite_failed" }
  | { result: "outcome_unknown" }
  | { result: "nothing_claimed" }
  | { result: "fenced" };

export type DispatchEngineDeps = {
  /** Must commit the attempt row before returning. Returns null when nothing is claimable. */
  claim(): Promise<ClaimedDispatch | null>;
  /** Performs exactly one provider attempt and classifies the result. */
  send(claimed: ClaimedDispatch): Promise<DispatchClassification>;
  /** Generation-fenced publish. Returns false when this worker lost the fence. */
  finalize(claimed: ClaimedDispatch, outcome: DispatchClassification): Promise<boolean>;
};

export async function runExecutionDispatch(deps: DispatchEngineDeps): Promise<DispatchRunResult> {
  const claimed = await deps.claim();
  if (!claimed) return { result: "nothing_claimed" };

  const outcome = await deps.send(claimed);

  let published: boolean;
  try {
    published = await deps.finalize(claimed, outcome);
  } catch {
    // The write may have been performed; the request stays `dispatching` and is
    // recovered by the stale-lease path into `outcome_unknown`, never re-sent.
    published = false;
  }
  if (!published) return { result: "fenced" };

  if (outcome.kind === "accepted") return { result: "sent" };
  if (outcome.kind === "definite_reject") return { result: "definite_failed" };
  return { result: "outcome_unknown" };
}

export type ClaimedObservation = {
  actionId: number;
  generation: number;
  namespace: string;
  actionType: string;
  providerRef: string | null;
  providerIncidentId: string | null;
  attemptNumber: number;
};

export type ObservationRunResult =
  | { result: "verified" }
  | { result: "failed" }
  | { result: "still_running" }
  | { result: "needs_review"; reason: string }
  | { result: "nothing_claimed" }
  | { result: "fenced" };

export type ObservationEngineDeps = {
  claim(): Promise<ClaimedObservation | null>;
  /** Read-only provider status lookup. Must never send a write. */
  observe(claimed: ClaimedObservation): Promise<ObservationDecision>;
  finalize(claimed: ClaimedObservation, outcome: ObservationDecision): Promise<boolean>;
};

export async function runExecutionObservation(deps: ObservationEngineDeps): Promise<ObservationRunResult> {
  const claimed = await deps.claim();
  if (!claimed) return { result: "nothing_claimed" };

  const outcome = await deps.observe(claimed);
  const published = await deps.finalize(claimed, outcome).catch(() => false);
  if (!published) return { result: "fenced" };

  switch (outcome.kind) {
    case "still_running":
      return { result: "still_running" };
    case "finished":
      return { result: outcome.outcome === "completed" ? "verified" : "failed" };
    case "deadline_exceeded":
      return { result: "needs_review", reason: "observation_deadline_exceeded" };
    case "unreadable":
      return { result: "needs_review", reason: "status_unreadable" };
  }
}

/**
 * Classify a dispatch lease that expired without a published result.
 *
 * A lease can expire after the request left the process, so the reconciler can
 * never conclude "not sent". It becomes `outcome_unknown` and is resolved by
 * observation.
 */
export function classifyStaleDispatchLease(): "outcome_unknown" {
  return "outcome_unknown";
}

/**
 * Whether a queued request may still be cancelled. Only a request that never
 * reached `dispatching` is provably unsent.
 */
export function isCancellable(state: string): boolean {
  return state === "pending_approval" || state === "queued";
}
