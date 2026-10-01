import { describe, expect, it } from "vitest";
import { compareRackOrder, moveRack } from "./rack-order";

const r = (name: string, floorRow: string | null = null, floorSlot: number | null = null) => ({ name, floorRow, floorSlot });
const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("compareRackOrder", () => {
  it("orders by row, then slot, then name (numeric)", () => {
    const list = [r("Z", "B", 1), r("Rack 10"), r("C", "A", 2), r("D", "A", 1), r("Rack 2")];
    expect(names(list.sort(compareRackOrder))).toEqual(["D", "C", "Z", "Rack 2", "Rack 10"]);
  });

  it("orders racks without a row by slot first, so a saved drag order holds", () => {
    const list = [r("Alpha", null, 2), r("Beta", null, 1), r("Gamma")];
    expect(names(list.sort(compareRackOrder))).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("merges row case and whitespace", () => {
    const list = [r("Y", " b ", 1), r("X", "A", 1), r("W", "B", 2)];
    expect(names(list.sort(compareRackOrder))).toEqual(["X", "Y", "W"]);
  });
});

describe("moveRack", () => {
  const room = [r("A1", "A", 1), r("A2", "A", 2), r("A3", "A", 3), r("B1", "B", 1)];

  it("moves within a row and renumbers that row's slots 1..n", () => {
    const out = moveRack(room, "A3", "A1");
    expect(out).toEqual([
      { name: "A3", floorRow: "A", floorSlot: 1 },
      { name: "A1", floorRow: "A", floorSlot: 2 },
      { name: "A2", floorRow: "A", floorSlot: 3 },
    ]);
  });

  it("joins the target's row when dropped on a rack in another row", () => {
    const out = moveRack(room, "B1", "A2");
    expect(out).toContainEqual({ name: "B1", floorRow: "A", floorSlot: 2 });
    expect(out).toContainEqual({ name: "A2", floorRow: "A", floorSlot: 3 });
    expect(out).toContainEqual({ name: "A3", floorRow: "A", floorSlot: 4 });
  });

  it("moves forward past the target (drop after it)", () => {
    const out = moveRack(room, "A1", "A3");
    expect(out).toEqual([
      { name: "A2", floorRow: "A", floorSlot: 1 },
      { name: "A3", floorRow: "A", floorSlot: 2 },
      { name: "A1", floorRow: "A", floorSlot: 3 },
    ]);
  });

  it("orders rowless racks too (row stays null)", () => {
    const out = moveRack([r("P"), r("Q"), r("S")], "S", "P");
    expect(out).toEqual([
      { name: "S", floorRow: null, floorSlot: 1 },
      { name: "P", floorRow: null, floorSlot: 2 },
      { name: "Q", floorRow: null, floorSlot: 3 },
    ]);
  });

  it("returns nothing for a no-op or unknown rack", () => {
    expect(moveRack(room, "A1", "A1")).toEqual([]);
    expect(moveRack(room, "nope", "A1")).toEqual([]);
  });
});
