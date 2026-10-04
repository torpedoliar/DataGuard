import { describe, expect, it } from "vitest";
import { RACK_D, RACK_W, U, peerRackFraming, rackHeight, uToY } from "./constants";

/**
 * The peer-rack miniature is its own <Canvas> with no controls and one fixed
 * camera, so if the framing is wrong the extremes of the rack fall outside the
 * viewport and the highlighted peer slab simply is not on screen. The card's
 * whole job is to show that slab, and no browser test can reach the R3F canvas
 * here, so the projection is reproduced arithmetically instead.
 */

// NDC y of a point in the mini's local (unscaled) rack space. Mirrors the
// component exactly: group = scale then translate [0, offsetY, 0], camera at
// `framing.camera` looking at the origin with up +Y.
function ndcY(totalU: number, localY: number, localZ: number): number {
    const framing = peerRackFraming(totalU);
    const p = [0, localY * framing.scale + framing.offsetY, localZ * framing.scale];
    const eye = framing.camera;
    const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
    const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
    const cross = (a: number[], b: number[]) =>
        [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a: number[]) => { const L = Math.hypot(...a); return a.map((v) => v / L); };

    const forward = norm(sub([0, 0, 0], eye));
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const d = sub(p, eye);
    return dot(d, up) / (-dot(d, forward) * Math.tan((framing.fov * Math.PI) / 180 / 2));
}

// The face plane of the devices, just in front of the chassis.
const faceZ = RACK_D / 2 + 0.004;

describe("peerRackFraming", () => {
    it("centres the scaled rack on the camera axis", () => {
        for (const totalU of [1, 12, 42, 48]) {
            const { scale, offsetY } = peerRackFraming(totalU);
            const mid = (rackHeight(totalU) / 2) * scale + offsetY;
            expect(Math.abs(mid)).toBeLessThan(1e-9);
        }
    });

    it("keeps the bottom-most and top-most unit of a full rack inside the viewport", () => {
        // A peer in U1 or U42 of a 42U rack is the ordinary case, not an edge one.
        for (const totalU of [1, 12, 42, 48]) {
            for (const u of [1, totalU]) {
                const y = uToY(u) + U / 2;
                expect(Math.abs(ndcY(totalU, y, faceZ))).toBeLessThan(1);
            }
        }
    });

    it("keeps every unit of a 42U rack inside the viewport", () => {
        for (let u = 1; u <= 42; u++) {
            const y = uToY(u) + U / 2;
            expect(Math.abs(ndcY(42, y, faceZ))).toBeLessThan(1);
        }
    });

    it("starts far enough back to show the whole rack with margin", () => {
        // The card is small and the user can now orbit, so the opening view has
        // to read as the whole rack at a glance, not cropped to the viewport edge.
        for (const totalU of [1, 12, 42, 48]) {
            for (const u of [1, totalU]) {
                const y = uToY(u) + U / 2;
                expect(Math.abs(ndcY(totalU, y, faceZ))).toBeLessThan(0.8);
            }
        }
    });

    it("keeps the closest zoom outside the rack", () => {
        // minDistance is measured from the look-at point (the origin). Anything
        // inside the scaled rack's radius lets the camera clip through the chassis.
        for (const totalU of [1, 42, 48]) {
            const { scale, minDistance } = peerRackFraming(totalU);
            const reach = Math.hypot(RACK_W / 2, rackHeight(totalU) / 2, RACK_D / 2) * scale;
            expect(minDistance).toBeGreaterThan(reach);
        }
    });
});
