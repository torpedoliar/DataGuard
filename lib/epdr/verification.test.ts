import { describe, expect, it } from "vitest";
import { decideClose, decideScanNext, isVerifiedClean } from "./verification";

describe("decideScanNext", () => {
  it("escalates failed/unknown/incomplete to needs_review", () => {
    expect(decideScanNext({ status: "failed", affectedItems: 0, resultsComplete: true, rescanCount: 0 }).kind).toBe("needs_review");
    expect(decideScanNext({ status: "unknown", affectedItems: 0, resultsComplete: true, rescanCount: 0 }).kind).toBe("needs_review");
    expect(decideScanNext({ status: "succeeded", affectedItems: 0, resultsComplete: false, rescanCount: 0 }).kind).toBe("needs_review");
    expect(decideScanNext({ status: "succeeded", affectedItems: null, resultsComplete: true, rescanCount: 0 }).kind).toBe("needs_review");
  });

  it("rescans once on dirty, escalates after the second dirty result", () => {
    expect(decideScanNext({ status: "succeeded", affectedItems: 2, resultsComplete: true, rescanCount: 0 }).kind).toBe("rescan");
    expect(decideScanNext({ status: "succeeded", affectedItems: 2, resultsComplete: true, rescanCount: 1 }).kind).toBe("needs_review");
  });

  it("verifies a clean complete scan", () => {
    expect(decideScanNext({ status: "succeeded", affectedItems: 0, resultsComplete: true, rescanCount: 0 }).kind).toBe("verifying");
  });
});

function gates(overrides: Partial<Parameters<typeof decideClose>[0]> = {}) {
  return {
    observationElapsed: true,
    scanStartedAfterOccurrence: true,
    scanClean: true,
    resultsComplete: true,
    coverageFresh: true,
    noNewDetection: true,
    noHold: true,
    noPendingApproval: true,
    closureModeAllows: true,
    ...overrides,
  };
}

describe("decideClose", () => {
  it("allows only when every gate holds", () => {
    expect(decideClose(gates()).allowed).toBe(true);
    for (const key of ["observationElapsed", "scanStartedAfterOccurrence", "scanClean", "resultsComplete", "coverageFresh", "noNewDetection", "noHold", "noPendingApproval", "closureModeAllows"] as const) {
      const result = decideClose(gates({ [key]: false }));
      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("isVerifiedClean", () => {
  it("requires succeeded + complete + affected 0", () => {
    expect(isVerifiedClean("succeeded", 0, true)).toBe(true);
    expect(isVerifiedClean("succeeded", 1, true)).toBe(false);
    expect(isVerifiedClean("succeeded", 0, false)).toBe(false);
    expect(isVerifiedClean("failed", 0, true)).toBe(false);
  });
});