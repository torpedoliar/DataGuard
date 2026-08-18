import { describe, expect, it } from "vitest";
import { rackCapacityErrorMessage, rackPlacementExceedsCapacity, rackRangesOverlap } from "./rack-validation";

describe("rackRangesOverlap", () => {
  it("detects overlapping U ranges", () => {
    expect(
      rackRangesOverlap(
        { rackPosition: 10, uHeight: 2 },
        { rackPosition: 11, uHeight: 1 },
      ),
    ).toBe(true);
  });

  it("allows adjacent U ranges", () => {
    expect(
      rackRangesOverlap(
        { rackPosition: 10, uHeight: 2 },
        { rackPosition: 12, uHeight: 1 },
      ),
    ).toBe(false);
  });
});

describe("rackPlacementExceedsCapacity", () => {
  it("allows a placement that ends exactly at the top U", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 40, uHeight: 3, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 1, totalU: 42 })).toBe(false);
  });

  it("rejects a placement that overflows past the top U", () => {
    // 41 + 4 - 1 = 44 > 42: the audit's exact drag-drop overflow scenario
    expect(rackPlacementExceedsCapacity({ rackPosition: 41, uHeight: 4, totalU: 42 })).toBe(true);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 2, totalU: 42 })).toBe(true);
  });

  it("rejects positions below U1", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 0, uHeight: 1, totalU: 42 })).toBe(true);
    expect(rackPlacementExceedsCapacity({ rackPosition: -3, uHeight: 1, totalU: 42 })).toBe(true);
  });

  it("allows U1 as the bottom row", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 1, uHeight: 1, totalU: 42 })).toBe(false);
  });

  it("treats a missing rack position as 'no placement' and always fits", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: null, uHeight: 4, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: undefined, uHeight: 4, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: "", uHeight: 4, totalU: 42 })).toBe(false);
  });

  it("defaults a missing totalU to 42U, mirroring the client U list", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 1 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 4 })).toBe(true);
  });

  it("defaults a missing or zero uHeight to 1U", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: null, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 0, totalU: 42 })).toBe(false);
  });

  it("coerces string numeric inputs from JSON bodies", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: "41", uHeight: "4", totalU: "42" })).toBe(true);
    expect(rackPlacementExceedsCapacity({ rackPosition: "38", uHeight: "4", totalU: "42" })).toBe(false);
  });

  it("rejects non-numeric positions fail-closed", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: "abc", uHeight: 1, totalU: 42 })).toBe(true);
  });
});

describe("rackCapacityErrorMessage", () => {
  it("reports the rack capacity in Indonesian", () => {
    expect(rackCapacityErrorMessage(42)).toBe("Posisi melebihi kapasitas rak (maksimal U42).");
    expect(rackCapacityErrorMessage(48)).toBe("Posisi melebihi kapasitas rak (maksimal U48).");
  });

  it("falls back to 42U when the rack has no totalU", () => {
    expect(rackCapacityErrorMessage(null)).toBe("Posisi melebihi kapasitas rak (maksimal U42).");
    expect(rackCapacityErrorMessage(undefined)).toBe("Posisi melebihi kapasitas rak (maksimal U42).");
  });
});
