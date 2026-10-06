import { describe, expect, it } from "vitest";
import { facilityAssetSchema, facilityDimensions } from "./facility-asset";

const ups = { assetType: "ups", facilitySpecs: { subtype: "floor-standing", capacityKva: 20 }, locationId: 1, floorX: null, floorZ: null, floorRotation: null };

describe("facility asset validation", () => {
    it.each([
        ["leonardo-tuar0611", "top-blow", 0.83, 0.44, 2],
        ["inrow-300", "in-row", 0.3, 1.095, 1.991],
    ])("resolves %s reference envelope in metres", (visualProfile, subtype, width, depth, height) => {
        const asset = facilityAssetSchema.parse({ ...ups, assetType: "pac", facilitySpecs: { subtype, visualProfile } });
        expect(facilityDimensions(asset)).toMatchObject({ width, depth, height, estimated: false });
    });
    it("rejects a profile paired with the wrong PAC subtype", () => {
        expect(facilityAssetSchema.safeParse({ ...ups, assetType: "pac", facilitySpecs: { subtype: "in-row", visualProfile: "leonardo-tuar0611" } }).success).toBe(false);
    });
    it("retains explicit measurements over profile dimensions", () => {
        const asset = facilityAssetSchema.parse({ ...ups, assetType: "pac", facilitySpecs: { subtype: "top-blow", visualProfile: "leonardo-tuar0611", widthMm: 850 } });
        expect(facilityDimensions(asset).width).toBe(0.85);
    });
    it("resolves APC UPS reference dimensions without inventing rated kW", () => {
        const asset = facilityAssetSchema.parse({ ...ups, facilitySpecs: { subtype: "floor-standing", visualProfile: "apc-20kva", capacityKva: 20 } });
        expect(facilityDimensions(asset)).toMatchObject({ width: 0.52, depth: 0.84, height: 1.49 });
        expect(asset.facilitySpecs).toMatchObject({ ratedKw: null });
    });
    it("keeps unknown UPS kW distinct from its known kVA", () => {
        const result = facilityAssetSchema.parse(ups);
        expect(result.facilitySpecs).toMatchObject({ capacityKva: 20, ratedKw: null });
        expect(result.floorX).toBeNull();
    });

    it("rejects partial placement, rack mounting and invalid measured dimensions", () => {
        expect(facilityAssetSchema.safeParse({ ...ups, floorX: 2 }).success).toBe(false);
        expect(facilityAssetSchema.safeParse({ ...ups, rackName: "UPS rack" }).success).toBe(false);
        expect(facilityAssetSchema.safeParse({ ...ups, facilitySpecs: { subtype: "floor-standing", widthMm: -1 } }).success).toBe(false);
        expect(facilityAssetSchema.safeParse({ ...ups, floorX: Infinity, floorZ: 2, floorRotation: 0 }).success).toBe(false);
    });

    it("normalizes rotation and requires a room for placed assets", () => {
        expect(facilityAssetSchema.parse({ ...ups, floorX: 2, floorZ: 3, floorRotation: -90 }).floorRotation).toBe(270);
        expect(facilityAssetSchema.safeParse({ ...ups, locationId: null, floorX: 2, floorZ: 3, floorRotation: 0 }).success).toBe(false);
    });

    it("rejects specifications for a different asset kind", () => {
        expect(facilityAssetSchema.safeParse({ ...ups, facilitySpecs: { subtype: "in-row", coolingKw: 30 } }).success).toBe(false);
        expect(facilityAssetSchema.safeParse({ ...ups, facilitySpecs: { subtype: "floor-standing", coolingKw: 30 } }).success).toBe(false);
    });

    it("uses measured millimetres without presenting fallback dimensions as measured", () => {
        const result = facilityAssetSchema.parse({ ...ups, assetType: "pac", facilitySpecs: { subtype: "in-row", widthMm: 300 } });
        expect(facilityDimensions(result)).toMatchObject({ width: 0.3, estimated: true });
        expect(result.facilitySpecs).toMatchObject({ widthMm: 300, depthMm: null, heightMm: null });
    });
});
