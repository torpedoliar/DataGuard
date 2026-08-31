import { describe, expect, it } from "vitest";
import { selectScopeDevices, sortRacksByLayout } from "./checklist-scope";

const racks = [
  { name: "R2", zone: "B" },
  { name: "r1", zone: "A" },
  { name: "R3", zone: null },
];

const devices = [
  { id: 1, name: "sw-2", categoryId: 2, rackName: "R2", rackPosition: 10 },
  { id: 2, name: "srv-b", categoryId: 1, rackName: "R2", rackPosition: 2 },
  { id: 3, name: "srv-a", categoryId: 1, rackName: "R2", rackPosition: 20 },
  { id: 4, name: "r1-dev", categoryId: 2, rackName: "r1", rackPosition: 5 },
  { id: 5, name: "loose", categoryId: 2, rackName: null, rackPosition: null },
];

const device = (id: number) => devices.find((d) => d.id === id)!;

describe("sortRacksByLayout", () => {
  it("orders racks by zone then name (zone-less racks first, like rack layout)", () => {
    expect(sortRacksByLayout(racks).map((r) => r.name)).toEqual(["R3", "r1", "R2"]);
  });
});

describe("selectScopeDevices", () => {
  it("returns every device when no scope is active", () => {
    const result = selectScopeDevices(devices, racks, "category", {});
    expect(result.map((d) => d.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("filters by category without reordering", () => {
    const result = selectScopeDevices(devices, racks, "category", { categoryId: 2 });
    expect(result.map((d) => d.id)).toEqual([1, 4, 5]);
  });

  it("filters by rack (case-insensitive) and orders by rack layout then position", () => {
    const result = selectScopeDevices(devices, racks, "rack", { rackNames: ["r2"] });
    expect(result.map((d) => d.id)).toEqual([2, 1, 3]);
  });

  it("unions selected racks in layout walk order", () => {
    const result = selectScopeDevices(devices, racks, "rack", { rackNames: ["R2", "r1"] });
    expect(result.map((d) => d.id)).toEqual([4, 2, 1, 3]);
  });

  it("treats an empty rack selection as all devices", () => {
    const result = selectScopeDevices(devices, racks, "rack", { rackNames: [] });
    expect(result.map((d) => d.id)).toEqual([4, 2, 1, 3, 5]);
  });

  it("orders all devices in rack mode without selection", () => {
    const all = selectScopeDevices(devices, racks, "rack", {});
    expect(all.map((d) => d.id)).toEqual([4, 2, 1, 3, 5]);
  });
});
