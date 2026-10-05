import { describe, expect, it } from "vitest";
import { footprintCorners, validateRoomLayout, roomLayoutSchema } from "./room-layout";

const room = { width: 10, depth: 8, height: 3 };
const box = { key: "device:1", x: 2, z: 2, rotation: 0, width: 1, depth: 2, height: 2, estimated: false };

describe("room layout footprints", () => {
    it("blocks known footprint overlap even when height is unknown", () => {
        const partial = { ...box, estimated: true, footprintEstimated: false, heightEstimated: true };
        expect(validateRoomLayout(room, [partial, { ...partial, key: "device:2", x: 2.1 }]).errors.length).toBeGreaterThan(0);
    });
    it("rotates the footprint around its centre", () => {
        expect(footprintCorners({ ...box, rotation: 90 })).toEqual([
            { x: 1, z: 2.5 }, { x: 1, z: 1.5 }, { x: 3, z: 1.5 }, { x: 3, z: 2.5 },
        ]);
    });
    it("blocks measured overlap and out-of-room placement but permits touching edges", () => {
        expect(validateRoomLayout(room, [box, { ...box, key: "rack:2", x: 2.4 }]).errors.length).toBeGreaterThan(0);
        expect(validateRoomLayout(room, [box, { ...box, key: "rack:2", x: 3 }]).errors).toEqual([]);
        expect(validateRoomLayout(room, [{ ...box, x: 0.1 }]).errors.length).toBeGreaterThan(0);
        expect(validateRoomLayout(room, [{ ...box, height: 4 }]).errors.length).toBeGreaterThan(0);
    });
    it("warns rather than claiming measured clearance when dimensions are estimated", () => {
        const result = validateRoomLayout(room, [box, { ...box, key: "device:2", x: 2.4, estimated: true }]);
        expect(result.errors).toEqual([]);
        expect(result.warnings.length).toBeGreaterThan(0);
    });
    it("uses oriented rectangles rather than their enclosing boxes for collision", () => {
        const thin = { ...box, width: 4, depth: 0.2, rotation: 45, x: 4, z: 4 };
        expect(validateRoomLayout(room, [thin, { ...thin, key: "rack:2", x: 4, z: 4.5 }]).errors).toEqual([]);
    });
    it("rejects duplicate asset keys and incomplete or nonfinite room sizes", () => {
        const payload = { siteId: 1, roomId: 2, revision: 0, ...room, assets: [box, box], acknowledgeEstimated: false };
        expect(roomLayoutSchema.safeParse(payload).success).toBe(false);
        expect(roomLayoutSchema.safeParse({ ...payload, assets: [], width: Infinity }).success).toBe(false);
        expect(roomLayoutSchema.safeParse({ ...payload, assets: [], height: 0 }).success).toBe(false);
    });
});
