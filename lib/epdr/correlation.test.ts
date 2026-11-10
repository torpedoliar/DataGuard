import { describe, expect, it } from "vitest";
import { correlate, escalateSeverity, type CorrelationContext } from "./correlation";

function base(overrides: Partial<CorrelationContext> = {}): CorrelationContext {
  return {
    endpointId: 1,
    threatKey: "malware:md5-a",
    detectedAtMs: 10_000,
    correlationWindowMs: 60_000,
    reopenWindowMs: 7 * 24 * 60 * 60 * 1000,
    openWorkflow: null,
    closedWorkflow: null,
    ...overrides,
  };
}

describe("escalateSeverity", () => {
  it("raises one level and caps at Critical", () => {
    expect(escalateSeverity("Low")).toBe("Medium");
    expect(escalateSeverity("High")).toBe("Critical");
    expect(escalateSeverity("Critical")).toBe("Critical");
  });
});

describe("correlate", () => {
  it("attaches when a matching open workflow is within the window", () => {
    const result = correlate(base({
      openWorkflow: { incidentId: 7, lastDetectionAtMs: 5_000, severity: "High", inProgress: true },
    }));
    expect(result).toEqual({ kind: "attach", incidentId: 7 });
  });

  it("does not attach across the correlation window (new occurrence later)", () => {
    const result = correlate(base({
      detectedAtMs: 5_000_000,
      openWorkflow: { incidentId: 7, lastDetectionAtMs: 5_000, severity: "High", inProgress: true },
    }));
    expect(result.kind).toBe("create");
  });

  it("reopens a matching closed workflow within the reopen window", () => {
    const result = correlate(base({
      closedWorkflow: { incidentId: 9, closedAtMs: 9_000, severity: "High", reopenCount: 1 },
    }));
    expect(result).toEqual({ kind: "reopen", incidentId: 9, reopenCount: 2, severity: "Critical" });
  });

  it("creates a new episode when nothing matches", () => {
    expect(correlate(base()).kind).toBe("create");
  });
});