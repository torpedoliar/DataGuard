/**
 * Typed EPDR action state machine (T07). Pure — no DB, no network. The DB write
 * transitions use conditional `UPDATE … WHERE state = expected` (see the action
 * server module); this file defines the valid transitions and the event/state
 * vocabulary that every caller and its tests share.
 */

export const EPDR_ACTION_STATES = [
  "pending_approval",
  "queued",
  "dispatching",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "outcome_unknown",
  "needs_review",
] as const;

export type EpdrActionState = (typeof EPDR_ACTION_STATES)[number];

export const EPDR_ACTION_MODES = ["approval", "automatic", "manual"] as const;
export type EpdrActionMode = (typeof EPDR_ACTION_MODES)[number];

export type ActionEvent =
  | "approve"
  | "reject"
  | "expire"
  | "cancel"
  | "claim"
  | "accepted"
  | "timeout"
  | "definite_reject"
  | "task_completed"
  | "task_failed"
  | "deadline_passed"
  | "reconcile_match"
  | "reconcile_fail"
  | "reconcile_ambiguous";

const TRANSITIONS: Record<EpdrActionState, Partial<Record<ActionEvent, EpdrActionState>>> = {
  pending_approval: { approve: "queued", reject: "cancelled", expire: "cancelled" },
  queued: { claim: "dispatching", cancel: "cancelled" },
  dispatching: { accepted: "in_progress", timeout: "outcome_unknown", definite_reject: "failed", cancel: "cancelled" },
  in_progress: { task_completed: "completed", task_failed: "failed", deadline_passed: "failed" },
  completed: {},
  failed: {},
  cancelled: {},
  outcome_unknown: { reconcile_match: "in_progress", reconcile_fail: "failed", reconcile_ambiguous: "needs_review" },
  needs_review: {},
};

export function nextState(current: EpdrActionState, event: ActionEvent): EpdrActionState | null {
  return TRANSITIONS[current][event] ?? null;
}

export function canTransition(current: EpdrActionState, event: ActionEvent): boolean {
  return nextState(current, event) !== null;
}

export function isTerminal(state: EpdrActionState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "needs_review";
}

/** Build the durable idempotency key: action_type:endpoint:incident:evaluation. */
export function actionIdempotencyKey(input: {
  actionType: string;
  endpointId: number;
  incidentId: number | null;
  evaluationId?: number | null;
}): string {
  return [input.actionType, input.endpointId, input.incidentId ?? "none", input.evaluationId ?? "none"].join(":");
}