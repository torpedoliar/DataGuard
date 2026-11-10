/**
 * Scan verification + close decision (T08). Pure — no DB, no network. Resolution
 * requires actual clean scan evidence starting after the latest occurrence,
 * complete results, fresh coverage through observation, and no outstanding
 * hold/approval. A clean disk scan alone never qualifies IOA/Exploit as fully
 * evidenced (caller-enforced via closure policy ceiling).
 */
import type { ScanStatusClassification } from "./task-tracker";

export type ScanOutcomeInput = {
  status: ScanStatusClassification;
  affectedItems: number | null;
  resultsComplete: boolean;
  rescanCount: number;
};

export type ScanNext =
  | { kind: "needs_review" }
  | { kind: "rescan" }
  | { kind: "verifying" };

export function decideScanNext(o: ScanOutcomeInput): ScanNext {
  if (o.status === "failed" || o.status === "unknown") return { kind: "needs_review" };
  if (o.status === "pending") return { kind: "needs_review" };
  if (!o.resultsComplete) return { kind: "needs_review" };
  // status === succeeded, complete results.
  const affected = o.affectedItems;
  if (affected === null) return { kind: "needs_review" }; // null is not zero
  if (affected > 0) {
    return o.rescanCount >= 1 ? { kind: "needs_review" } : { kind: "rescan" };
  }
  return { kind: "verifying" };
}

export type CloseGateInput = {
  observationElapsed: boolean;
  scanStartedAfterOccurrence: boolean;
  scanClean: boolean;
  resultsComplete: boolean;
  coverageFresh: boolean;
  noNewDetection: boolean;
  noHold: boolean;
  noPendingApproval: boolean;
  closureModeAllows: boolean; // closure mode (auto/approval) + category ceiling
};

export type CloseResult = { allowed: boolean; reasons: string[] };

export function decideClose(input: CloseGateInput): CloseResult {
  const reasons: string[] = [];
  if (!input.observationElapsed) reasons.push("observation_not_elapsed");
  if (!input.scanStartedAfterOccurrence) reasons.push("scan_not_after_occurrence");
  if (!input.scanClean) reasons.push("scan_not_clean");
  if (!input.resultsComplete) reasons.push("results_incomplete");
  if (!input.coverageFresh) reasons.push("coverage_not_fresh");
  if (!input.noNewDetection) reasons.push("new_detection");
  if (!input.noHold) reasons.push("held");
  if (!input.noPendingApproval) reasons.push("pending_approval");
  if (!input.closureModeAllows) reasons.push("closure_mode_disallowed");
  return { allowed: reasons.length === 0, reasons };
}

/** Convenience: a completed clean scan is not itself proof of disinfection. */
export function isVerifiedClean(status: ScanStatusClassification, affectedItems: number | null, resultsComplete: boolean): boolean {
  return status === "succeeded" && resultsComplete && affectedItems === 0;
}