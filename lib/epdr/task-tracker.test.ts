import { describe, expect, it } from "vitest";
import { classifyScanStatus, decideAdoption, isCleanScan } from "./task-tracker";

describe("classifyScanStatus", () => {
  it("maps 0/1/6 to pending, 2 to succeeded, 3/4/5/7 to failed", () => {
    expect(classifyScanStatus(0)).toBe("pending");
    expect(classifyScanStatus(1)).toBe("pending");
    expect(classifyScanStatus(6)).toBe("pending");
    expect(classifyScanStatus(2)).toBe("succeeded");
    expect(classifyScanStatus(3)).toBe("failed");
    expect(classifyScanStatus(4)).toBe("failed");
    expect(classifyScanStatus(5)).toBe("failed");
    expect(classifyScanStatus(7)).toBe("failed");
  });

  it("never treats null/unknown as clean", () => {
    expect(classifyScanStatus(null)).toBe("unknown");
    expect(classifyScanStatus(99)).toBe("unknown");
  });
});

describe("decideAdoption / isCleanScan", () => {
  it("adopts only a single exact marker match", () => {
    expect(decideAdoption(1)).toBe("adopt");
    expect(decideAdoption(0)).toBe("needs_review");
    expect(decideAdoption(2)).toBe("needs_review");
  });

  it("requires complete results for a clean scan", () => {
    expect(isCleanScan("succeeded", true)).toBe(true);
    expect(isCleanScan("succeeded", false)).toBe(false);
    expect(isCleanScan("pending", true)).toBe(false);
  });
});