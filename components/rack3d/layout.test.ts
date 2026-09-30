import { describe, expect, it } from "vitest";
import { RACK_D, RACK_W, ROW_PITCH, SLOT_PITCH, TILE } from "./constants";
import { bounds, coldAisleTiles, floorPlanRect, layoutRacks, roomRect, tileKey, UNPLACED_ROW, type PlacedRack } from "./layout";

const rack = (name: string, floorRow: string | null = null, floorSlot: number | null = null, facing: string | null = "front") =>
  ({ name, floorRow, floorSlot, facing });
const byName = <T extends PlacedRack>(list: T[]) => Object.fromEntries(list.map((p) => [p.rack.name, p]));
const onHalfTile = (v: number) => {
  const k = v / TILE + 0.5;
  return Math.abs(k - Math.round(k)) < 1e-9;
};

describe("layoutRacks", () => {
  it("returns nothing for no racks", () => {
    expect(layoutRacks([])).toEqual([]);
  });

  it("auto-arranges unplaced racks in one row sorted by name (numeric)", () => {
    const out = byName(layoutRacks([rack("Rack 10"), rack("Rack 2"), rack("Rack 1")]));
    expect([out["Rack 1"].slot, out["Rack 2"].slot, out["Rack 10"].slot]).toEqual([1, 2, 3]);
    expect(out["Rack 2"].x - out["Rack 1"].x).toBeCloseTo(SLOT_PITCH);
    expect(out["Rack 1"].z).toBeCloseTo(out["Rack 10"].z);
    expect(out["Rack 1"].row).toBe("");
    expect(out["Rack 1"].unplaced).toBe(true);
  });

  it("places racks by row and slot with rows ROW_PITCH apart", () => {
    const out = byName(layoutRacks([rack("B1", "B", 1), rack("A2", "A", 2), rack("A1", "A", 1)]));
    expect(out.A2.x - out.A1.x).toBeCloseTo(SLOT_PITCH);
    expect(out.B1.z - out.A1.z).toBeCloseTo(ROW_PITCH);
    expect(out.B1.x).toBeCloseTo(out.A1.x);
    expect(out.A1.unplaced).toBe(false);
  });

  it("keeps physical gaps between slots", () => {
    const out = byName(layoutRacks([rack("A1", "A", 1), rack("A5", "A", 5)]));
    expect(out.A5.x - out.A1.x).toBeCloseTo(4 * SLOT_PITCH);
  });

  it("rotates back-facing racks and treats unknown facing as front", () => {
    const out = byName(layoutRacks([rack("A1", "A", 1, "back"), rack("A2", "A", 2, "FRONT"), rack("A3", "A", 3, null)]));
    expect(out.A1.rotationY).toBeCloseTo(Math.PI);
    expect(out.A2.rotationY).toBe(0);
    expect(out.A3.rotationY).toBe(0);
  });

  it("shifts a colliding rack to the next free slot and flags it", () => {
    const out = byName(layoutRacks([rack("Beta", "A", 1), rack("Alpha", "A", 1)]));
    expect(out.Alpha.slot).toBe(1);
    expect(out.Alpha.collision).toBe(false);
    expect(out.Beta.slot).toBe(2);
    expect(out.Beta.collision).toBe(true);
  });

  it("appends a rack with a row but no slot after the last slot", () => {
    const out = byName(layoutRacks([rack("A3", "A", 3), rack("Loose", "A", null)]));
    expect(out.Loose.slot).toBe(4);
  });

  it("puts unplaced (legacy) racks in an Unplaced row behind placed rows", () => {
    const out = byName(layoutRacks([rack("A1", "A", 1), rack("Legacy")]));
    expect(out.Legacy.row).toBe(UNPLACED_ROW);
    expect(out.Legacy.unplaced).toBe(true);
    expect(out.Legacy.z - out.A1.z).toBeCloseTo(ROW_PITCH);
  });

  it("centres the layout on the origin", () => {
    const b = bounds(layoutRacks([rack("A1", "A", 1), rack("A4", "A", 4), rack("B1", "B", 1)]));
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(0);
  });
});

describe("bounds", () => {
  it("covers the rack footprint", () => {
    const b = bounds(layoutRacks([rack("A1", "A", 1)]));
    expect(b.maxX - b.minX).toBeCloseTo(RACK_W);
    expect(b.maxZ - b.minZ).toBeCloseTo(RACK_D);
  });

  it("has a finite default for an empty room", () => {
    expect(bounds([])).toEqual({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
  });
});

describe("coldAisleTiles", () => {
  it("marks the tile in front of each rack door", () => {
    const [front] = layoutRacks([rack("A1", "A", 1)]);
    expect([...coldAisleTiles([front])]).toEqual([tileKey(0, RACK_D / 2 + TILE / 2)]);
    const [back] = layoutRacks([rack("A1", "A", 1, "back")]);
    expect([...coldAisleTiles([back])]).toEqual([tileKey(0, -(RACK_D / 2 + TILE / 2))]);
  });
});

describe("roomRect", () => {
  it("snaps walls to tile edges and contains bounds plus margin", () => {
    const b = { minX: -0.3, maxX: 0.3, minZ: -0.535, maxZ: 0.535 };
    const r = roomRect(b, 2);
    for (const v of [r.x0, r.x1, r.z0, r.z1]) expect(onHalfTile(v)).toBe(true);
    expect(r.x0).toBeLessThanOrEqual(-2.3);
    expect(r.x1).toBeGreaterThanOrEqual(2.3);
    expect(r.z0).toBeLessThanOrEqual(-2.535);
    expect(r.z1).toBeGreaterThanOrEqual(2.535);
  });
});

describe("floorPlanRect", () => {
  const b = { minX: -2, maxX: 2, minZ: -1, maxZ: 1 }; // 4 x 2, padded by 1 m = 6 x 4

  it("fits a wide image so the padded bounds lie inside it", () => {
    expect(floorPlanRect(b, 3, 1)).toEqual({ width: 12, depth: 4, cx: 0, cz: 0 });
  });

  it("fits a tall image so the padded bounds lie inside it", () => {
    expect(floorPlanRect(b, 1, 1)).toEqual({ width: 6, depth: 6, cx: 0, cz: 0 });
  });
});
