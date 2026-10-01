import { describe, expect, it } from "vitest";
import { foldIncidents, NO_INCIDENTS } from "./rack-signals";

describe("foldIncidents", () => {
  it("sums counts per device and keeps the worst severity", () => {
    const map = foldIncidents([
      { deviceId: 1, severity: "Low", count: 2 },
      { deviceId: 1, severity: "High", count: 1 },
      { deviceId: 1, severity: "Medium", count: 3 },
      { deviceId: 2, severity: "Critical", count: 1 },
    ]);
    expect(map.get(1)).toEqual({ count: 6, maxSeverity: "High" });
    expect(map.get(2)).toEqual({ count: 1, maxSeverity: "Critical" });
    expect(map.get(3)).toBeUndefined();
  });

  it("accepts counts that arrive as strings from count(*)", () => {
    const map = foldIncidents([{ deviceId: 1, severity: "Low", count: "4" as unknown as number }]);
    expect(map.get(1)?.count).toBe(4);
  });

  it("exposes an empty default", () => {
    expect(NO_INCIDENTS).toEqual({ count: 0, maxSeverity: null });
  });
});
