import { describe, expect, it } from "vitest";
import { aisleAngle } from "./room-camera";

describe("aisle camera", () => {
    it("changes sides when an obstruction moves across the rack front", () => {
        const rack = { x: 0, z: 0, radius: 0.5, rotationY: 0 };
        const obstructed = (x: number) => aisleAngle([rack, { x, z: 1.2, radius: 0.65 }]);
        expect(obstructed(0.5)).toBeLessThan(0);
        expect(obstructed(-0.5)).toBeGreaterThan(0);
    });

    it("looks at the face of a single rotated rack", () => {
        expect(aisleAngle([{ x: 3, z: 4, radius: 0.5, rotationY: Math.PI / 2 }])).toBeCloseTo(Math.PI / 2);
    });
});
