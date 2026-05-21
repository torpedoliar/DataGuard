import { describe, expect, it } from "vitest";
import { parseNetworkPortImportRows } from "./network-port-import";

const vlanRefs = [
  { id: 10, vlanId: 100, name: "Server" },
  { id: 11, vlanId: 200, name: "User" },
];

describe("network port import parser", () => {
  it("normalizes a valid row with defaults", () => {
    const result = parseNetworkPortImportRows(
      [{ "Port Name": " Gi1/0/1 ", "VLAN ID": "100" }],
      { deviceId: 7, vlanRefs, existingPortNames: [] },
    );

    expect(result.errors).toEqual([]);
    expect(result.ports).toEqual([
      expect.objectContaining({
        deviceId: 7,
        portName: "Gi1/0/1",
        vlanId: 10,
        portMode: "Access",
        status: "Active",
        speed: "1G",
        mediaType: "Copper (RJ45)",
        macAddress: null,
        ipAddress: null,
        trunkVlans: null,
        description: null,
      }),
    ]);
  });

  it("maps blank VLAN to null", () => {
    const result = parseNetworkPortImportRows([{ "Port Name": "Eth1", "VLAN ID": "" }], {
      deviceId: 7,
      vlanRefs,
      existingPortNames: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.ports[0].vlanId).toBeNull();
  });

  it("reports invalid enum values with row numbers", () => {
    const result = parseNetworkPortImportRows([{ "Port Name": "Eth1", "Port Mode": "Bad" }], {
      deviceId: 7,
      vlanRefs,
      existingPortNames: [],
    });

    expect(result.errors).toEqual(["Row 2: Port Mode must be one of Access, Trunk, Routed, LACP."]);
  });

  it("rejects duplicate port names inside the sheet", () => {
    const result = parseNetworkPortImportRows([{ "Port Name": "Eth1" }, { "Port Name": "Eth1" }], {
      deviceId: 7,
      vlanRefs,
      existingPortNames: [],
    });

    expect(result.errors).toContain("Row 3: Port Name duplicates another row in this file.");
  });

  it("rejects existing port names", () => {
    const result = parseNetworkPortImportRows([{ "Port Name": "Eth1" }], {
      deviceId: 7,
      vlanRefs,
      existingPortNames: ["Eth1"],
    });

    expect(result.errors).toEqual(["Row 2: Port Name already exists on this device."]);
  });

  it("rejects empty sheets", () => {
    const result = parseNetworkPortImportRows([], { deviceId: 7, vlanRefs, existingPortNames: [] });

    expect(result.errors).toEqual(["No port rows found in import file."]);
  });

  it("rejects unknown VLAN numbers", () => {
    const result = parseNetworkPortImportRows([{ "Port Name": "Eth1", "VLAN ID": "999" }], {
      deviceId: 7,
      vlanRefs,
      existingPortNames: [],
    });

    expect(result.errors).toEqual(["Row 2: VLAN ID 999 does not exist in this site."]);
  });
});