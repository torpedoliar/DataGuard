import { describe, expect, it } from "vitest";
import { actionIdempotencyKey, canTransition, isTerminal, nextState } from "./actions";

describe("epdr action state machine", () => {
  it("approve/reject/cancel/claim transitions", () => {
    expect(nextState("pending_approval", "approve")).toBe("queued");
    expect(nextState("pending_approval", "reject")).toBe("cancelled");
    expect(nextState("pending_approval", "expire")).toBe("cancelled");
    expect(nextState("queued", "claim")).toBe("dispatching");
    expect(nextState("queued", "cancel")).toBe("cancelled");
  });

  it("dispatching outcomes", () => {
    expect(nextState("dispatching", "accepted")).toBe("in_progress");
    expect(nextState("dispatching", "timeout")).toBe("outcome_unknown");
    expect(nextState("dispatching", "definite_reject")).toBe("failed");
  });

  it("in-progress terminal outcomes", () => {
    expect(nextState("in_progress", "task_completed")).toBe("completed");
    expect(nextState("in_progress", "task_failed")).toBe("failed");
    expect(nextState("in_progress", "deadline_passed")).toBe("failed");
  });

  it("reconciliation of unknown outcome never auto-resends", () => {
    expect(nextState("outcome_unknown", "reconcile_match")).toBe("in_progress");
    expect(nextState("outcome_unknown", "reconcile_fail")).toBe("failed");
    expect(nextState("outcome_unknown", "reconcile_ambiguous")).toBe("needs_review");
    expect(canTransition("outcome_unknown", "claim")).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["completed", "failed", "cancelled", "needs_review"] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(canTransition(s, "approve")).toBe(false);
    }
  });

  it("builds a stable idempotency key", () => {
    expect(actionIdempotencyKey({ actionType: "scan", endpointId: 5, incidentId: 9, evaluationId: 1 })).toBe("scan:5:9:1");
    expect(actionIdempotencyKey({ actionType: "scan", endpointId: 5, incidentId: null })).toBe("scan:5:none:none");
  });
});