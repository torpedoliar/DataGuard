import { z } from "zod";

const optionalText = z.string().trim().max(500).nullable().default(null);
const measuredMm = z.number().finite().positive().max(10000).nullable().default(null);
const capacity = z.number().finite().positive().max(100000).nullable().default(null);
const date = z.iso.date().nullable().default(null);
const common = {
    model: optionalText,
    serialNumber: optionalText,
    widthMm: measuredMm,
    depthMm: measuredMm,
    heightMm: measuredMm,
    installedOn: date,
    maintainedOn: date,
    coverageNotes: z.string().trim().max(2000).nullable().default(null),
};
const pacSpecs = z.strictObject({
    ...common,
    subtype: z.enum(["in-row", "top-blow"]),
    supplyAirflow: z.enum(["front", "rear", "top", "bottom"]).nullable().default(null),
    coolingKw: capacity,
});
const upsSpecs = z.strictObject({
    ...common,
    subtype: z.literal("floor-standing"),
    capacityKva: capacity,
    ratedKw: capacity,
    battery: z.enum(["internal", "external", "unknown"]).default("unknown"),
});
const placement = {
    locationId: z.number().int().positive().nullable(),
    floorX: z.number().finite().min(-1000).max(1000).nullable(),
    floorZ: z.number().finite().min(-1000).max(1000).nullable(),
    floorRotation: z.number().finite().nullable().transform((n) => n === null ? null : ((n % 360) + 360) % 360),
    rackName: z.null().optional(),
    rackPosition: z.null().optional(),
    uHeight: z.null().optional(),
};
export const facilityAssetSchema = z.discriminatedUnion("assetType", [
    z.object({ ...placement, assetType: z.literal("pac"), facilitySpecs: pacSpecs }),
    z.object({ ...placement, assetType: z.literal("ups"), facilitySpecs: upsSpecs }),
]).superRefine((asset, context) => {
    const positions = [asset.floorX, asset.floorZ, asset.floorRotation];
    if (positions.some((n) => n !== null) && positions.some((n) => n === null)) {
        context.addIssue({ code: "custom", path: ["floorX"], message: "Posisi lantai harus lengkap atau Unplaced." });
    }
    if (asset.floorX !== null && asset.locationId === null) {
        context.addIssue({ code: "custom", path: ["locationId"], message: "Penempatan memerlukan ruangan." });
    }
});

export type AssetType = "standard" | "pac" | "ups";
export type FacilityAsset = z.infer<typeof facilityAssetSchema>;
export type FacilitySpecs = FacilityAsset["facilitySpecs"];

export function facilityDimensions(asset: { assetType: string; facilitySpecs: FacilitySpecs | null }) {
    const specs = asset.facilitySpecs;
    // Generic display proportions, never persisted as measured specifications.
    const fallback = asset.assetType === "ups" ? [0.6, 0.8, 1.5] : specs?.subtype === "in-row" ? [0.3, 1.07, 2] : [1.2, 0.9, 2];
    return {
        width: specs?.widthMm != null ? specs.widthMm / 1000 : fallback[0],
        depth: specs?.depthMm != null ? specs.depthMm / 1000 : fallback[1],
        height: specs?.heightMm != null ? specs.heightMm / 1000 : fallback[2],
        estimated: specs?.widthMm == null || specs.depthMm == null || specs.heightMm == null,
        footprintEstimated: specs?.widthMm == null || specs.depthMm == null,
        heightEstimated: specs?.heightMm == null,
    };
}

export function facilityLabel(assetType: string, specs?: FacilitySpecs | null) {
    if (assetType === "ups") return "UPS floor-standing";
    if (assetType === "pac") return specs?.subtype === "in-row" ? "PAC in-row" : "PAC top-blow";
    return "Standard";
}
