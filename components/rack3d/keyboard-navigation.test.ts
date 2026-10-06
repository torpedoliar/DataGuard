import { describe, expect, it } from "vitest";
import { navigationKey, navigationStep } from "./keyboard-navigation";

describe("camera navigation", () => {
    it("maps movement and normalizes diagonals", () => {
        expect(navigationKey("W")).toBe(true);
        expect(navigationKey("Escape")).toBe(false);
        const step = navigationStep(new Set(["w", "d"]), 0.02);
        expect(Math.hypot(step.x, step.z)).toBeCloseTo(0.03);
        expect(step.x).toBeGreaterThan(0); expect(step.z).toBeGreaterThan(0);
    });
    it("caps delta and supports zoom, orbit and acceleration", () => {
        expect(navigationStep(new Set(["w", "shift"]), 10).z).toBeCloseTo(0.2);
        expect(navigationStep(new Set(["+"]), 0.02).zoom).toBeGreaterThan(0);
        expect(navigationStep(new Set(["arrowleft"]), 0.02).yaw).toBeLessThan(0);
        expect(navigationStep(new Set(), 1).z).toBe(0);
    });
});
