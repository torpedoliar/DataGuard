import { describe, expect, it } from "vitest";
import {
  isSiemAlertStatus,
  isSiemFindingStatus,
  isSiemRuleType,
  isSiemSeverity,
  siemAlertStatuses,
  siemFindingStatuses,
  siemRuleTypes,
  siemSeverities,
} from "./types";

describe("SIEM type helpers", () => {
  it("exports stable enum values", () => {
    expect(siemSeverities).toEqual(["Low", "Medium", "High", "Critical"]);
    expect(siemFindingStatuses).toEqual(["Open", "Acknowledged", "Resolved"]);
    expect(siemAlertStatuses).toEqual(["pending", "sent", "failed"]);
    expect(siemRuleTypes).toEqual(["single_event", "threshold", "sequence", "absence", "baseline_anomaly"]);
  });

  it("accepts valid values and rejects invalid values", () => {
    expect(isSiemSeverity("High")).toBe(true);
    expect(isSiemSeverity("Emergency")).toBe(false);
    expect(isSiemFindingStatus("Acknowledged")).toBe(true);
    expect(isSiemFindingStatus("Closed")).toBe(false);
    expect(isSiemAlertStatus("failed")).toBe(true);
    expect(isSiemAlertStatus("error")).toBe(false);
    expect(isSiemRuleType("threshold")).toBe(true);
    expect(isSiemRuleType("correlation")).toBe(false);
  });
});
