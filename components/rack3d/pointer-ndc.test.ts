import { describe, expect, it } from "vitest";
import { pointerNdc } from "./pointer-ndc";

// A canvas drawn at x=100, y=50, 1000px wide and 500px tall.
const canvas = { left: 100, top: 50, width: 1000, height: 500 };

describe("pointerNdc", () => {
    it("maps the centre of the element to the origin", () => {
        const [x, y] = pointerNdc(600, 300, canvas);
        expect(x).toBeCloseTo(0);
        expect(y).toBeCloseTo(0);
    });

    it("maps the top-left corner to (-1, 1) and the bottom-right to (1, -1)", () => {
        expect(pointerNdc(100, 50, canvas)).toEqual([-1, 1]);
        expect(pointerNdc(1100, 550, canvas)).toEqual([1, -1]);
    });

    it("follows the cursor, not the event target's offset", () => {
        // The cursor is at the centre of the canvas, but the event landed on a
        // 320px card near the canvas origin, so `offsetX` reads 40 instead of
        // 500. A ray built from that offset selects a device a whole rack away.
        const offsetX = 40;
        const fromOffset = (offsetX / canvas.width) * 2 - 1;
        const [x] = pointerNdc(600, 300, canvas);
        expect(x).toBeCloseTo(0);
        expect(Math.abs(x - fromOffset)).toBeGreaterThan(0.5);
    });
});
