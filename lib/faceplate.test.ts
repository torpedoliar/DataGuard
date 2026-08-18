import { describe, expect, it } from "vitest";
import {
  buildFaceplate,
  comparePortNames,
  faceplateSlotColors,
  hexToRgb,
  isFaceplateConfigured,
  isUplinkMedia,
  normalizeFaceplateConfig,
  parsePortIndex,
  resolveSlotNumber,
  splitPortName,
  suggestPortName,
} from "./faceplate";

type TestPort = {
  id: number;
  portName: string;
  portIndex?: number | null;
  mediaType?: string | null;
  status?: string | null;
  portMode?: string | null;
};

function port(id: number, portName: string, extra: Partial<TestPort> = {}): TestPort {
  return { id, portName, ...extra };
}

function slotAt<T extends { slotNumber: number }>(slots: T[], slotNumber: number) {
  const slot = slots.find((candidate) => candidate.slotNumber === slotNumber);
  if (!slot) throw new Error(`slot ${slotNumber} not found`);
  return slot;
}

describe("parsePortIndex", () => {
  it("takes the last numeric group of an interface name", () => {
    expect(parsePortIndex("Gi1/0/13")).toBe(13);
    expect(parsePortIndex("TenGigabitEthernet1/1/4")).toBe(4);
    expect(parsePortIndex("Eth7")).toBe(7);
    expect(parsePortIndex("ether24")).toBe(24);
  });

  it("returns null when there is no usable number", () => {
    expect(parsePortIndex("mgmt")).toBeNull();
    expect(parsePortIndex("eth0")).toBeNull();
    expect(parsePortIndex("")).toBeNull();
    expect(parsePortIndex(null)).toBeNull();
  });

  it("strips subinterface suffixes before deriving the port number", () => {
    expect(parsePortIndex("Gi1/0/2.10")).toBe(2);
    expect(parsePortIndex("Gi1/0/13.100")).toBe(13);
    expect(parsePortIndex("Te1/1/4.500")).toBe(4);
  });

  it("treats SVIs and link bundles as logical interfaces with no physical slot", () => {
    expect(parsePortIndex("Vlan10")).toBeNull();
    expect(parsePortIndex("Port-Channel1")).toBeNull();
    expect(parsePortIndex("PortChannel3")).toBeNull();
    expect(parsePortIndex("Vlan10.100")).toBeNull();
    expect(parsePortIndex("Port-Channel1.100")).toBeNull();
  });
});

describe("comparePortNames", () => {
  it("sorts numerically rather than lexicographically", () => {
    const sorted = ["Gi1/0/10", "Gi1/0/2", "Gi1/0/1"].sort(comparePortNames);
    expect(sorted).toEqual(["Gi1/0/1", "Gi1/0/2", "Gi1/0/10"]);
  });
});

describe("isUplinkMedia", () => {
  it("treats fiber and twinax as uplink media", () => {
    expect(isUplinkMedia("Fiber (SFP/SFP+)")).toBe(true);
    expect(isUplinkMedia("Twinax (DAC)")).toBe(true);
    expect(isUplinkMedia("Copper (RJ45)")).toBe(false);
    expect(isUplinkMedia(null)).toBe(false);
  });
});

describe("normalizeFaceplateConfig", () => {
  it("defaults to a two row zigzag faceplate", () => {
    expect(normalizeFaceplateConfig({ portCount: 24 })).toEqual({
      portCount: 24,
      uplinkCount: 0,
      rows: 2,
      numbering: "zigzag",
    });
  });

  it("clamps out of range values and rejects unknown numbering", () => {
    expect(normalizeFaceplateConfig({ portCount: 500, uplinkCount: 99, rows: 7, numbering: "spiral" })).toEqual({
      portCount: 96,
      uplinkCount: 16,
      rows: 2,
      numbering: "zigzag",
    });
  });

  it("reports whether a device has a faceplate at all", () => {
    expect(isFaceplateConfigured(null)).toBe(false);
    expect(isFaceplateConfigured({ portCount: 0 })).toBe(false);
    expect(isFaceplateConfigured({ portCount: 8 })).toBe(true);
  });
});

describe("buildFaceplate layout", () => {
  it("places odd slots on the top row and even slots below for zigzag numbering", () => {
    const faceplate = buildFaceplate({ portCount: 24 }, [] as TestPort[]);

    expect(faceplate.slots).toHaveLength(24);
    expect(slotAt(faceplate.slots, 1)).toMatchObject({ row: 1, column: 1 });
    expect(slotAt(faceplate.slots, 2)).toMatchObject({ row: 2, column: 1 });
    expect(slotAt(faceplate.slots, 3)).toMatchObject({ row: 1, column: 2 });
    expect(slotAt(faceplate.slots, 24)).toMatchObject({ row: 2, column: 12 });
  });

  it("fills the top row first for sequential numbering", () => {
    const faceplate = buildFaceplate({ portCount: 24, numbering: "sequential" }, [] as TestPort[]);

    expect(slotAt(faceplate.slots, 12)).toMatchObject({ row: 1, column: 12 });
    expect(slotAt(faceplate.slots, 13)).toMatchObject({ row: 2, column: 1 });
  });

  it("lays out a single row when rows is 1", () => {
    const faceplate = buildFaceplate({ portCount: 5, rows: 1 }, [] as TestPort[]);

    expect(faceplate.slots).toHaveLength(5);
    expect(faceplate.slots.every((slot) => slot.row === 1)).toBe(true);
    expect(slotAt(faceplate.slots, 5).column).toBe(5);
  });

  it("leaves no slot for the missing half column on an odd port count", () => {
    const faceplate = buildFaceplate({ portCount: 25 }, [] as TestPort[]);

    expect(faceplate.slots).toHaveLength(25);
    expect(slotAt(faceplate.slots, 25)).toMatchObject({ row: 1, column: 13 });
    expect(faceplate.slots.some((slot) => slot.slotNumber === 26)).toBe(false);
  });

  it("numbers the uplink block after the access block and offsets it horizontally", () => {
    const faceplate = buildFaceplate({ portCount: 24, uplinkCount: 4 }, [] as TestPort[]);

    expect(faceplate.slots).toHaveLength(28);
    expect(slotAt(faceplate.slots, 25).block).toBe("uplink");
    expect(slotAt(faceplate.slots, 25).blockNumber).toBe(1);
    // Access block spans 12 columns of 22 units with 3 unit gaps, starting at x=10.
    expect(slotAt(faceplate.slots, 24).x).toBe(10 + 11 * 25);
    // Uplink block starts one 16 unit block gap after the access block ends.
    expect(slotAt(faceplate.slots, 25).x).toBe(10 + 297 + 16);
    expect(slotAt(faceplate.slots, 25).width).toBe(28);
    expect(faceplate.blocks.map((block) => block.block)).toEqual(["access", "uplink"]);
  });

  it("computes an overall canvas size that contains every slot", () => {
    const faceplate = buildFaceplate({ portCount: 24 }, [] as TestPort[]);

    expect(faceplate.width).toBe(317);
    expect(faceplate.height).toBe(69);
    for (const slot of faceplate.slots) {
      expect(slot.x + slot.width).toBeLessThanOrEqual(faceplate.width);
      expect(slot.y + slot.height).toBeLessThanOrEqual(faceplate.height);
    }
  });
});

describe("buildFaceplate port placement", () => {
  it("maps ports onto slots using the number in their name", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [port(1, "Gi1/0/1"), port(2, "Gi1/0/8")]);

    expect(slotAt(faceplate.slots, 1).port?.id).toBe(1);
    expect(slotAt(faceplate.slots, 8).port?.id).toBe(2);
    expect(slotAt(faceplate.slots, 2).port).toBeNull();
    expect(faceplate.unplaced).toEqual([]);
  });

  it("steers fiber ports into the uplink block so they do not collide with copper ports", () => {
    const faceplate = buildFaceplate({ portCount: 24, uplinkCount: 4 }, [
      port(1, "Gi1/0/1", { mediaType: "Copper (RJ45)" }),
      port(2, "Te1/0/1", { mediaType: "Fiber (SFP/SFP+)" }),
    ]);

    expect(slotAt(faceplate.slots, 1).port?.id).toBe(1);
    expect(slotAt(faceplate.slots, 25).port?.id).toBe(2);
    expect(faceplate.unplaced).toEqual([]);
  });

  it("lets an explicit port index override the derived number", () => {
    const faceplate = buildFaceplate({ portCount: 12 }, [port(1, "uplink-a", { portIndex: 12 })]);

    expect(slotAt(faceplate.slots, 12).port?.id).toBe(1);
    expect(faceplate.unplaced).toEqual([]);
  });

  it("continues copper numbering into the uplink block when the name says so", () => {
    const faceplate = buildFaceplate({ portCount: 24, uplinkCount: 4 }, [
      port(1, "Gi1/0/26", { mediaType: "Copper (RJ45)" }),
    ]);

    expect(slotAt(faceplate.slots, 26).port?.id).toBe(1);
  });

  it("reports ports that fall outside the declared layout", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [port(1, "Gi1/0/9"), port(2, "Vlan10", { portIndex: 99 })]);

    expect(faceplate.slots.every((slot) => slot.port === null)).toBe(true);
    expect(faceplate.unplaced.map((item) => item.id).sort()).toEqual([1, 2]);
  });

  it("reports ports with no number in their name instead of guessing", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [port(1, "mgmt")]);

    expect(faceplate.unplaced.map((item) => item.id)).toEqual([1]);
  });

  it("places a subinterface on its physical slot and surfaces logical interfaces as unplaced", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [
      port(1, "Gi1/0/2.10"),
      port(2, "Vlan10"),
      port(3, "Port-Channel1"),
    ]);

    expect(slotAt(faceplate.slots, 2).port?.id).toBe(1);
    expect(faceplate.slots.filter((slot) => slot.port !== null)).toHaveLength(1);
    expect(faceplate.unplaced.map((item) => item.id).sort()).toEqual([2, 3]);
  });

  it("lets an explicit slot evict a port that only guessed that slot from its name", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [
      port(1, "Gi1/0/3"),
      port(2, "sfp-a", { portIndex: 3 }),
    ]);

    expect(slotAt(faceplate.slots, 3).port?.id).toBe(2);
    expect(faceplate.unplaced.map((item) => item.id)).toEqual([1]);
  });

  it("keeps the first explicit slot when two overrides collide", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [
      port(1, "aaa", { portIndex: 5 }),
      port(2, "bbb", { portIndex: 5 }),
    ]);

    expect(slotAt(faceplate.slots, 5).port?.id).toBe(1);
    expect(faceplate.unplaced.map((item) => item.id)).toEqual([2]);
  });

  it("keeps the first port when two ports resolve to the same slot", () => {
    const faceplate = buildFaceplate({ portCount: 8 }, [port(9, "Gi1/0/3"), port(4, "Eth3")]);

    expect(slotAt(faceplate.slots, 3).port?.portName).toBe("Eth3");
    expect(faceplate.unplaced.map((item) => item.portName)).toEqual(["Gi1/0/3"]);
  });

  it("places nothing when the device has no faceplate configured", () => {
    const faceplate = buildFaceplate({ portCount: 0 }, [port(1, "Gi1/0/1")]);

    expect(faceplate.slots).toEqual([]);
    expect(faceplate.unplaced.map((item) => item.id)).toEqual([1]);
  });
});

describe("resolveSlotNumber", () => {
  const config = normalizeFaceplateConfig({ portCount: 24, uplinkCount: 4 });

  it("returns null for an override beyond the faceplate", () => {
    expect(resolveSlotNumber({ id: 1, portName: "Gi1/0/1", portIndex: 40 }, config)).toBeNull();
  });

  it("ignores a zero or negative override and falls back to the name", () => {
    expect(resolveSlotNumber({ id: 1, portName: "Gi1/0/6", portIndex: 0 }, config)).toBe(6);
    expect(resolveSlotNumber({ id: 1, portName: "Gi1/0/6", portIndex: -3 }, config)).toBe(6);
  });
});

describe("faceplateSlotColors", () => {
  it("distinguishes empty, active, inactive and down slots", () => {
    const empty = faceplateSlotColors(null).fill;
    const active = faceplateSlotColors({ status: "Active" }).fill;
    const inactive = faceplateSlotColors({ status: "Inactive" }).fill;
    const down = faceplateSlotColors({ status: "Down" }).fill;

    expect(new Set([empty, active, inactive, down]).size).toBe(4);
  });

  it("adds a mode accent only for non access modes", () => {
    expect(faceplateSlotColors({ status: "Active", portMode: "Access" }).accent).toBeNull();
    expect(faceplateSlotColors({ status: "Active", portMode: "Trunk" }).accent).toBe("#a855f7");
  });
});

describe("splitPortName", () => {
  it("separates the trailing number from the prefix", () => {
    expect(splitPortName("Gi1/0/13")).toEqual({ prefix: "Gi1/0/", number: 13 });
    expect(splitPortName("ether7")).toEqual({ prefix: "ether", number: 7 });
  });

  it("keeps the whole name when it does not end in a number", () => {
    expect(splitPortName("mgmt")).toEqual({ prefix: "mgmt", number: null });
  });
});

describe("suggestPortName", () => {
  it("reuses the naming style the device already follows", () => {
    expect(suggestPortName(["Gi1/0/1", "Gi1/0/2", "Te1/1/1"], 9)).toBe("Gi1/0/9");
  });

  it("returns null when no existing name carries a number", () => {
    expect(suggestPortName(["mgmt", "console"], 3)).toBeNull();
    expect(suggestPortName([], 3)).toBeNull();
  });
});

describe("hexToRgb", () => {
  it("expands shorthand and full hex", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#15803d")).toEqual([21, 128, 61]);
  });
});
