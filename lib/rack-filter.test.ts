import { describe, expect, it } from "vitest";
import type { RackData, RackDevice } from "@/actions/rack-layout";
import { applyRackFilters, applyRackFiltersForScene, EMPTY_FILTERS, hasActiveFilters, singleMatchId } from "./rack-filter";

const dev = (id: number, name: string, extra: Partial<RackDevice> = {}): RackDevice => ({
  id, name, brandName: null, brandLogo: null, categoryId: 1, categoryName: "Server", categoryColor: null,
  locationName: "DC", photoPath: null, rackName: null, rackPosition: id, uHeight: 1, zone: null, status: "OK",
  faceplatePortCount: null, faceplateUplinkCount: null, faceplateRows: null, faceplateNumbering: null, ports: [],
  isCritical: false, ipAddress: null, assetCode: null, openIncidents: { count: 0, maxSeverity: null }, ...extra,
});
const rack = (name: string, devices: RackDevice[], extra: Partial<RackData> = {}): RackData => ({
  name, zone: "RED", totalU: 42, devices, occupiedU: [], locationName: "DC",
  locationId: 1, floorRow: null, floorSlot: null, facing: null, ...extra,
});

const racks = [
  rack("Rack Network", [dev(1, "Core Switch", { categoryName: "Network" }), dev(2, "Firewall", { status: "NOT OK" })]),
  rack("Rack Server", [dev(3, "Nutanix G8"), dev(4, "Veeam Storage", { brandName: "Dell" })], { zone: "BLUE" }),
  rack("Rack Lab", [dev(5, "Test Box")], { locationName: "Lab" }),
];

describe("applyRackFilters", () => {
  it("returns every rack with nothing muted when no filter is active", () => {
    const out = applyRackFilters(racks, EMPTY_FILTERS);
    expect(out.map((r) => r.name)).toEqual(["Rack Network", "Rack Server", "Rack Lab"]);
    expect(out.flatMap((r) => r.devices).every((d) => !d.isMuted)).toBe(true);
  });

  it("search keeps racks with a matching device (name or brand) and mutes the rest", () => {
    const out = applyRackFilters(racks, { ...EMPTY_FILTERS, search: "dell" });
    expect(out.map((r) => r.name)).toEqual(["Rack Server"]);
    expect(out[0].devices.map((d) => d.isMuted)).toEqual([true, false]);
  });

  it("search matching a rack name keeps the rack even when no device matches", () => {
    const out = applyRackFilters(racks, { ...EMPTY_FILTERS, search: "rack lab" });
    expect(out.map((r) => r.name)).toEqual(["Rack Lab"]);
    expect(out[0].devices[0].isMuted).toBe(true);
  });

  it("zone and location filters hide racks without muting devices", () => {
    expect(applyRackFilters(racks, { ...EMPTY_FILTERS, zone: "BLUE" }).map((r) => r.name)).toEqual(["Rack Server"]);
    const lab = applyRackFilters(racks, { ...EMPTY_FILTERS, location: "Lab" });
    expect(lab.map((r) => r.name)).toEqual(["Rack Lab"]);
    expect(lab[0].devices[0].isMuted).toBe(false);
  });

  it("status filter mutes non-matching devices but keeps racks visible (2D behaviour)", () => {
    const out = applyRackFilters(racks, { ...EMPTY_FILTERS, status: "NOT OK" });
    expect(out.map((r) => r.name)).toEqual(["Rack Network", "Rack Server", "Rack Lab"]);
    expect(out[0].devices.map((d) => d.isMuted)).toEqual([true, false]);
    expect(out[1].hasMatchingDevices).toBe(false);
  });
});

describe("applyRackFiltersForScene", () => {
  it("keeps hidden racks as dimmed with all devices muted", () => {
    const out = applyRackFiltersForScene(racks, { ...EMPTY_FILTERS, zone: "BLUE" });
    expect(out.map((r) => [r.name, r.dimmed])).toEqual([["Rack Network", true], ["Rack Server", false], ["Rack Lab", true]]);
    expect(out[0].devices.every((d) => d.isMuted)).toBe(true);
  });
});

describe("singleMatchId / hasActiveFilters", () => {
  it("returns the id when exactly one device matches an active filter", () => {
    const f = { ...EMPTY_FILTERS, search: "nutanix" };
    expect(singleMatchId(applyRackFilters(racks, f), f)).toBe(3);
  });

  it("returns null with no active filter or several matches", () => {
    expect(singleMatchId(applyRackFilters(racks, EMPTY_FILTERS), EMPTY_FILTERS)).toBeNull();
    const f = { ...EMPTY_FILTERS, search: "o" };
    expect(singleMatchId(applyRackFilters(racks, f), f)).toBeNull();
  });

  it("detects active filters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, location: "Lab" })).toBe(true);
  });
});
