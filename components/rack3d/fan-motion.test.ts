import { describe, expect, it } from "vitest";
import { fanRotation } from "./fan-motion";

describe("decorative fan motion", () => {
    it("moves only enabled visible animations without reduced motion", () => {
        expect(fanRotation(0, 0.02, true, false, false)).toBeCloseTo(0.024);
        expect(fanRotation(1, 0.02, false, false, false)).toBe(1);
        expect(fanRotation(1, 0.02, true, true, false)).toBe(1);
        expect(fanRotation(1, 0.02, true, false, true)).toBe(1);
    });
    it("caps resume delta and wraps rotation without affecting geometry", () => {
        expect(fanRotation(0, 20, true, false, false)).toBeCloseTo(0.06);
        expect(fanRotation(Math.PI * 2 - 0.01, 0.02, true, false, false)).toBeCloseTo(0.014);
    });
});
