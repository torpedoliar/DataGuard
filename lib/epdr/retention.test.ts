import { describe, expect, it } from "vitest";
import { effectiveRetentionWindows, retentionCutoffMs } from "./retention";

describe("retention windows", () => {
  it("falls back to the documented defaults", () => {
    expect(effectiveRetentionWindows(null, null)).toEqual({ attemptDays: 90, resultDays: 180 });
  });

  it("keeps operator-configured windows", () => {
    expect(effectiveRetentionWindows(30, 365)).toEqual({ attemptDays: 30, resultDays: 365 });
  });

  it("computes cutoffs deterministically", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(retentionCutoffMs(now, 90)).toBe(now - 90 * 24 * 60 * 60 * 1000);
    expect(retentionCutoffMs(now, 0)).toBe(now);
  });
});
