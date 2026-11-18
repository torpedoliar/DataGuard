/**
 * Reconciliation of an `outcome_unknown` request against provider state.
 *
 * Pure. The rule: adopt only one exact, unambiguous match. Zero matches under
 * eventual consistency is not proof of non-delivery; multiple matches is not a
 * pick-one situation. Both go to human review. Reconciliation never sends a
 * write.
 */
import { classifyScanStatus, type ScanStatusClassification } from "./task-tracker";

export type ReconciliationInput = {
  /** Exact matches found for this request's correlation marker. */
  exactMatches: number;
  /** Evidence that the correlation marker itself was readable this pass. */
  markerReadable: boolean;
  /** Provider status per matched candidate (already parsed). */
  candidateStatuses: readonly ScanStatusClassification[];
};

export type ReconciliationDecision =
  | { kind: "adopt_in_progress"; providerRef: string | null }
  | { kind: "adopt_completed"; resultsComplete: boolean }
  | { kind: "adopt_failed" }
  | { kind: "not_found_yet" }
  | { kind: "needs_review"; reason: "ambiguous_match" | "marker_unreadable" | "conflicting_status" };

/**
 * Zero matches stays unresolved: the write may still be accepted with delayed
 * visibility, so the request must not be declared failed or re-sent.
 */
export function reconcileUnknownOutcome(input: ReconciliationInput): ReconciliationDecision {
  if (!input.markerReadable) return { kind: "needs_review", reason: "marker_unreadable" };
  if (input.exactMatches === 0) return { kind: "not_found_yet" };
  if (input.exactMatches > 1) return { kind: "needs_review", reason: "ambiguous_match" };

  const status = input.candidateStatuses[0] ?? "unknown";
  if (status === "pending") return { kind: "adopt_in_progress", providerRef: null };
  if (status === "succeeded") return { kind: "adopt_completed", resultsComplete: false };
  // A failed provider task is a resolved failure, not a completion.
  if (status === "failed") return { kind: "adopt_failed" };
  return { kind: "needs_review", reason: "conflicting_status" };
}

export type ObservationDecision =
  | { kind: "still_running" }
  | { kind: "finished"; outcome: "completed" | "failed"; resultsComplete: boolean }
  | { kind: "deadline_exceeded" }
  | { kind: "unreadable" };

/**
 * Interpret a provider task status read. A numeric status that is unknown to
 * the classifier is unreadable, never "succeeded".
 */
export function interpretObservation(input: {
  rawStatus: number | null | undefined;
  resultsComplete: boolean;
  deadlineMs: number;
  nowMs: number;
}): ObservationDecision {
  const classification = classifyScanStatus(input.rawStatus);
  if (classification === "pending") {
    return input.nowMs >= input.deadlineMs ? { kind: "deadline_exceeded" } : { kind: "still_running" };
  }
  if (classification === "succeeded") return { kind: "finished", outcome: "completed", resultsComplete: input.resultsComplete };
  if (classification === "failed") return { kind: "finished", outcome: "failed", resultsComplete: false };
  return { kind: "unreadable" };
}

/**
 * ThreatSync action status interpretation. Only the example values the public
 * documentation uses are recognized; everything else stays unresolved because
 * the full enum is not published.
 */
export type ThreatSyncObservation =
  | { kind: "still_running" }
  | { kind: "finished"; outcome: "completed" | "failed" }
  | { kind: "unreadable" };

export function interpretThreatSyncStatus(raw: string | null | undefined): ThreatSyncObservation {
  if (!raw) return { kind: "unreadable" };
  const value = raw.trim().toLowerCase();
  if (value === "inprogress" || value === "in_progress") return { kind: "still_running" };
  if (value === "performed") return { kind: "finished", outcome: "completed" };
  return { kind: "unreadable" };
}

/**
 * `ts_incident_status` observation: the request completes only when the
 * provider reports exactly the status the operator asked for. A different
 * value is still running (eventual consistency), a missing value is unreadable.
 */
export function interpretIncidentStatusMatch(
  requested: string | null | undefined,
  current: string | null | undefined,
): ThreatSyncObservation {
  const wanted = requested?.trim().toLowerCase();
  const reported = current?.trim().toLowerCase();
  if (!wanted || !reported) return { kind: "unreadable" };
  return wanted === reported
    ? { kind: "finished", outcome: "completed" }
    : { kind: "still_running" };
}

/** Only values with an established meaning are classified. */
export function classifyIsolationState(raw: unknown): "isolated" | "not_isolated" | "unknown" {
  if (raw === 1 || raw === "1") return "isolated";
  if (raw === 0 || raw === "0") return "not_isolated";
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "isolated") return "isolated";
    if (normalized === "not_isolated" || normalized === "notisolated" || normalized === "not isolated") {
      return "not_isolated";
    }
  }
  return "unknown";
}

/**
 * Whether the endpoint reached the state an operator asked for. Used to decide
 * if an isolation request is *verified*, not merely accepted. An unrecognized
 * state is never treated as "not isolated".
 */
export function isIsolationVerified(input: {
  actionType: "isolate" | "unisolate" | "ts_isolate" | "ts_unisolate";
  isolationState: number | string | null | undefined;
}): boolean {
  const state = classifyIsolationState(input.isolationState);
  if (state === "unknown") return false;
  const wantsIsolation = input.actionType === "isolate" || input.actionType === "ts_isolate";
  return wantsIsolation ? state === "isolated" : state === "not_isolated";
}
