import { describe, expect, it } from "vitest";
import { freeRanges, inRack } from "./free-slots";

describe("freeRanges", () => {
  it("reports a whole empty rack as one range", () => {
    expect(freeRanges(42, [])).toEqual([{ start: 1, size: 42 }]);
  });

  it("reports nothing for a full rack", () => {
    expect(freeRanges(4, [{ rackPosition: 1, uHeight: 4 }])).toEqual([]);
  });

  it("handles multi-U devices and gaps", () => {
    expect(freeRanges(8, [{ rackPosition: 1, uHeight: 2 }, { rackPosition: 5, uHeight: 1 }]))
      .toEqual([{ start: 3, size: 2 }, { start: 6, size: 3 }]);
  });

  it("ignores unpositioned devices and clamps devices running past the top", () => {
    expect(freeRanges(42, [{ rackPosition: 41, uHeight: 4 }, { rackPosition: null, uHeight: 2 }]))
      .toEqual([{ start: 1, size: 40 }]);
  });

  it("tolerates overlapping bad data", () => {
    expect(freeRanges(6, [{ rackPosition: 1, uHeight: 3 }, { rackPosition: 2, uHeight: 3 }]))
      .toEqual([{ start: 5, size: 2 }]);
  });
});

describe("inRack", () => {
  it("accepts only devices fully inside 1..totalU", () => {
    expect(inRack({ rackPosition: 42, uHeight: 1 }, 42)).toBe(true);
    expect(inRack({ rackPosition: 41, uHeight: 4 }, 42)).toBe(false);
    expect(inRack({ rackPosition: 43, uHeight: 1 }, 42)).toBe(false);
    expect(inRack({ rackPosition: 0, uHeight: 1 }, 42)).toBe(false);
    expect(inRack({ rackPosition: null, uHeight: 1 }, 42)).toBe(false);
  });
});
