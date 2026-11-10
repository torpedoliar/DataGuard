/**
 * Scan task-status interpretation (T07). Pure — no DB, no network. Numeric scan
 * job status (0–7) maps to pending/succeeded/failed; unknown/null never counts
 * clean. Reconciliation of an ambiguous dispatch adopts by exact marker match
 * only, and multiple matches go to review (never a second POST).
 */

export type ScanStatusClassification = "pending" | "succeeded" | "failed" | "unknown";

export function classifyScanStatus(status: number | null | undefined): ScanStatusClassification {
  if (status === null || status === undefined) return "unknown";
  if (status === 0 || status === 1 || status === 6) return "pending";
  if (status === 2) return "succeeded";
  if (status === 3 || status === 4 || status === 5 || status === 7) return "failed";
  return "unknown";
}

export type AdoptionDecision = "adopt" | "needs_review";

/** One exact match adopts; zero/multiple/ambiguous → review (never re-send). */
export function decideAdoption(exactMatches: number): AdoptionDecision {
  return exactMatches === 1 ? "adopt" : "needs_review";
}

/** A completed scan is not clean evidence unless the full result pages are read. */
export function isCleanScan(status: ScanStatusClassification, resultsComplete: boolean): boolean {
  return status === "succeeded" && resultsComplete;
}