import { describe, expect, it, vi } from "vitest";
import {
  classifyStaleDispatchLease,
  isCancellable,
  runExecutionDispatch,
  runExecutionObservation,
  type ClaimedDispatch,
  type ClaimedObservation,
} from "./execution-engine";

const claimed: ClaimedDispatch = { actionId: 1, generation: 3, attemptNumber: 1, snapshotHash: "hash" };

describe("dispatch engine", () => {
  it("does nothing when nothing is claimable", async () => {
    const send = vi.fn();
    const result = await runExecutionDispatch({
      claim: async () => null,
      send,
      finalize: async () => true,
    });
    expect(result).toEqual({ result: "nothing_claimed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends exactly once and publishes acceptance", async () => {
    const send = vi.fn(async () => ({ kind: "accepted" as const, providerRef: "t1", providerJobId: "t1", affectedItems: null, response: null }));
    const finalize = vi.fn(async () => true);
    const result = await runExecutionDispatch({ claim: async () => claimed, send, finalize });
    expect(result).toEqual({ result: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("never retries after an ambiguous result", async () => {
    const send = vi.fn(async () => ({ kind: "outcome_unknown" as const, reason: "client_timeout" }));
    const finalize = vi.fn(async () => true);
    const result = await runExecutionDispatch({ claim: async () => claimed, send, finalize });
    expect(result).toEqual({ result: "outcome_unknown" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records a definite rejection without retrying", async () => {
    const send = vi.fn(async () => ({ kind: "definite_reject" as const, reason: "http_403" }));
    const finalize = vi.fn(async () => true);
    const result = await runExecutionDispatch({ claim: async () => claimed, send, finalize });
    expect(result).toEqual({ result: "definite_failed" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports fencing when a stale generation cannot publish", async () => {
    const result = await runExecutionDispatch({
      claim: async () => claimed,
      send: async () => ({ kind: "accepted", providerRef: "t1", providerJobId: null, affectedItems: null, response: null }),
      finalize: async () => false,
    });
    expect(result).toEqual({ result: "fenced" });
  });

  it("treats a finalize failure as fencing rather than success", async () => {
    const result = await runExecutionDispatch({
      claim: async () => claimed,
      send: async () => ({ kind: "accepted", providerRef: "t1", providerJobId: null, affectedItems: null, response: null }),
      finalize: async () => {
        throw new Error("db down");
      },
    });
    expect(result).toEqual({ result: "fenced" });
  });
});

describe("observation engine", () => {
  const observation: ClaimedObservation = {
    actionId: 1,
    generation: 3,
    namespace: "endpoint_security",
    actionType: "scan",
    providerRef: "task-1",
    providerIncidentId: null,
    attemptNumber: 2,
  };

  it("does nothing when nothing is claimable", async () => {
    const observe = vi.fn();
    const result = await runExecutionObservation({
      claim: async () => null,
      observe,
      finalize: async () => true,
    });
    expect(result).toEqual({ result: "nothing_claimed" });
    expect(observe).not.toHaveBeenCalled();
  });

  it("keeps a running task running", async () => {
    const result = await runExecutionObservation({
      claim: async () => observation,
      observe: async () => ({ kind: "still_running" }),
      finalize: async () => true,
    });
    expect(result).toEqual({ result: "still_running" });
  });

  it("publishes a completed observation without claiming cleanliness", async () => {
    const result = await runExecutionObservation({
      claim: async () => observation,
      observe: async () => ({ kind: "finished", outcome: "completed", resultsComplete: false }),
      finalize: async () => true,
    });
    expect(result).toEqual({ result: "verified" });
  });

  it("sends a deadline breach and an unreadable status to review", async () => {
    const exceeded = await runExecutionObservation({
      claim: async () => observation,
      observe: async () => ({ kind: "deadline_exceeded" }),
      finalize: async () => true,
    });
    expect(exceeded).toEqual({ result: "needs_review", reason: "observation_deadline_exceeded" });

    const unreadable = await runExecutionObservation({
      claim: async () => observation,
      observe: async () => ({ kind: "unreadable" }),
      finalize: async () => true,
    });
    expect(unreadable).toEqual({ result: "needs_review", reason: "status_unreadable" });
  });

  it("reports fencing when the publish loses the generation race", async () => {
    const result = await runExecutionObservation({
      claim: async () => observation,
      observe: async () => ({ kind: "still_running" }),
      finalize: async () => false,
    });
    expect(result).toEqual({ result: "fenced" });
  });
});

describe("stale lease handling", () => {
  it("never concludes that an expired dispatch lease was unsent", () => {
    expect(classifyStaleDispatchLease()).toBe("outcome_unknown");
  });

  it("only allows cancellation before a request reached dispatching", () => {
    expect(isCancellable("pending_approval")).toBe(true);
    expect(isCancellable("queued")).toBe(true);
    expect(isCancellable("dispatching")).toBe(false);
    expect(isCancellable("in_progress")).toBe(false);
    expect(isCancellable("outcome_unknown")).toBe(false);
  });
});
