import { describe, expect, it } from "vitest";
import { criticalProblem, foldIncidents, NO_INCIDENTS, occupancyBand, rackSummary, tourOrder, troubledCritical } from "./rack-signals";

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

const sig = (extra: Partial<{ isCritical: boolean; status: string; count: number }> = {}) => ({
  id: 1, name: "Core", isCritical: extra.isCritical ?? true, status: extra.status ?? "OK",
  openIncidents: { count: extra.count ?? 0, maxSeverity: extra.count ? ("High" as const) : null },
});

describe("criticalProblem", () => {
  it("is null for a healthy critical device and for any non-critical device", () => {
    expect(criticalProblem(sig())).toBeNull();
    expect(criticalProblem(sig({ isCritical: false, status: "NOT OK", count: 3 }))).toBeNull();
  });

  it("names today's failed check and open incidents", () => {
    expect(criticalProblem(sig({ status: "NOT OK" }))).toBe("NOT OK in today's audit");
    expect(criticalProblem(sig({ count: 1 }))).toBe("1 open incident");
    expect(criticalProblem(sig({ status: "NOT OK", count: 2 }))).toBe("NOT OK in today's audit · 2 open incidents");
  });

  it("does not flag a Pending (not yet audited) critical device", () => {
    expect(criticalProblem(sig({ status: "Pending" }))).toBeNull();
  });
});

describe("troubledCritical", () => {
  it("lists only critical devices with a problem, with their rack", () => {
    const racks = [
      { name: "R1", devices: [{ ...sig({ status: "NOT OK" }), id: 1 }, { ...sig(), id: 2 }] },
      { name: "R2", devices: [{ ...sig({ isCritical: false, status: "NOT OK" }), id: 3 }, { ...sig({ count: 1 }), id: 4 }] },
    ];
    expect(troubledCritical(racks).map((t) => [t.device.id, t.rackName])).toEqual([[1, "R1"], [4, "R2"]]);
  });
});

describe("occupancyBand", () => {
  const us = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it("bands at 60% and 85% of the rack", () => {
    expect(occupancyBand(us(25), 42)).toBe("low");   // 59.5%
    expect(occupancyBand(us(26), 42)).toBe("mid");   // 61.9%
    expect(occupancyBand(us(35), 42)).toBe("mid");   // 83.3%
    expect(occupancyBand(us(36), 42)).toBe("high");  // 85.7%
  });
  it("counts a U once even when devices overlap, and ignores U outside the rack", () => {
    expect(occupancyBand([1, 1, 2, 2, 50, 0], 2)).toBe("high");
    expect(occupancyBand([], 42)).toBe("low");
  });
  it("treats a zero-height rack as empty", () => {
    expect(occupancyBand([1], 0)).toBe("low");
  });
});

describe("tourOrder", () => {
  const r = (name: string, floorSlot: number, devices = [sig({ isCritical: false })]) => ({ name, floorRow: "A", floorSlot, devices });
  it("visits racks with a troubled critical device first, then layout order", () => {
    expect(tourOrder([r("A3", 3), r("A1", 1), r("A2", 2, [sig({ status: "NOT OK" })])])).toEqual(["A2", "A1", "A3"]);
  });
  it("is empty for an empty room", () => {
    expect(tourOrder([])).toEqual([]);
  });
});

describe("rackSummary", () => {
  it("counts device states and open incidents", () => {
    expect(rackSummary({ devices: [sig({ status: "OK", count: 2 }), sig({ status: "NOT OK" }), { ...sig(), status: undefined }] }))
      .toEqual({ devices: 3, ok: 1, notOk: 1, pending: 1, incidents: 2 });
  });
});
