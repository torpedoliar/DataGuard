/**
 * Detection → workflow correlation (T05). Pure — no DB, no network. Decides
 * whether an accepted detection attaches to an existing open episode, reopens
 * a recently-closed episode, or starts a new one. Same endpoint + same threat
 * key is required to correlate; same endpoint/time alone never merges
 * unrelated attacks (CONTRACTS C2).
 */
import type { EpdrSeverity } from "./detections";

export type CorrelationContext = {
  endpointId: number;
  threatKey: string;
  detectedAtMs: number;
  correlationWindowMs: number;
  reopenWindowMs: number;
  /** Matching open workflow (same endpoint + threat key), if any. */
  openWorkflow: {
    incidentId: number;
    lastDetectionAtMs: number;
    severity: EpdrSeverity;
    inProgress: boolean;
  } | null;
  /** Matching closed workflow (same endpoint + threat key), if any. */
  closedWorkflow: {
    incidentId: number;
    closedAtMs: number;
    severity: EpdrSeverity;
    reopenCount: number;
  } | null;
};

export type CorrelateDecision =
  | { kind: "create" }
  | { kind: "attach"; incidentId: number }
  | { kind: "reopen"; incidentId: number; reopenCount: number; severity: EpdrSeverity };

const SEVERITY_ORDER: EpdrSeverity[] = ["Low", "Medium", "High", "Critical"];

/** Raise one severity level, capped at Critical. */
export function escalateSeverity(severity: EpdrSeverity): EpdrSeverity {
  const idx = SEVERITY_ORDER.indexOf(severity);
  if (idx < 0 || idx >= SEVERITY_ORDER.length - 1) return "Critical";
  return SEVERITY_ORDER[idx + 1]!;
}

export function correlate(ctx: CorrelationContext): CorrelateDecision {
  const open = ctx.openWorkflow;
  if (open) {
    const withinWindow = ctx.detectedAtMs - open.lastDetectionAtMs <= ctx.correlationWindowMs
      && ctx.detectedAtMs >= open.lastDetectionAtMs;
    if (withinWindow) {
      return { kind: "attach", incidentId: open.incidentId };
    }
  }

  const closed = ctx.closedWorkflow;
  if (closed && ctx.detectedAtMs - closed.closedAtMs <= ctx.reopenWindowMs) {
    return {
      kind: "reopen",
      incidentId: closed.incidentId,
      reopenCount: closed.reopenCount + 1,
      severity: escalateSeverity(closed.severity),
    };
  }

  return { kind: "create" };
}