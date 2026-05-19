import { describe, expect, it } from "vitest";
import { rackRangesOverlap } from "./rack-validation";

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
