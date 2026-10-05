import { describe, expect, it } from "vitest";
import { parseFacilityForm } from "./facility-form";
import { facilityAssetSchema } from "./facility-asset";

describe("facility edit payload", () => {
    it("keeps stored specs and placement when a partial edit omits facility fields", () => {
        const stored = facilityAssetSchema.parse({ assetType: "ups", facilitySpecs: { subtype: "floor-standing", capacityKva: 20 }, locationId: 1, floorX: 2, floorZ: 3, floorRotation: 90 });
        expect(parseFacilityForm(new FormData(), stored)).toBe(stored);
    });
    it("rejects malformed JSON and attempts to mix rack and floor placement", () => {
        const form = new FormData();
        form.set("facilityAsset", "{");
        expect(() => parseFacilityForm(form)).toThrow();
        form.set("facilityAsset", JSON.stringify({ assetType: "pac", facilitySpecs: { subtype: "in-row" }, locationId: 1, floorX: null, floorZ: null, floorRotation: null, rackName: "R1" }));
        expect(() => parseFacilityForm(form)).toThrow();
    });
});
