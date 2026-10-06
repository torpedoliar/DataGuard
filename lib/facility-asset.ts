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
export const PAC_PROFILES = {
    "leonardo-tuar0611": { label: "Leonardo TUAR0611", subtype: "top-blow", widthMm: 830, depthMm: 440, heightMm: 2000 },
    "inrow-300": { label: "InRow 300 mm", subtype: "in-row", widthMm: 300, depthMm: 1095, heightMm: 1991 },
} as const;

const pacSpecs = z.strictObject({
    visualProfile: z.enum(["leonardo-tuar0611", "inrow-300"]).nullable().optional(),
    ...common,
    subtype: z.enum(["in-row", "top-blow"]),
    supplyAirflow: z.enum(["front", "rear", "top", "bottom"]).nullable().default(null),
    coolingKw: capacity,
});
export const UPS_PROFILES = {
    "apc-20kva": { label: "APC 20 kVA · ukuran referensi perkiraan", widthMm: 520, depthMm: 840, heightMm: 1490 },
} as const;
const upsSpecs = z.strictObject({
    visualProfile: z.literal("apc-20kva").nullable().optional(),
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
    if (asset.assetType === "pac" && asset.facilitySpecs.visualProfile && PAC_PROFILES[asset.facilitySpecs.visualProfile].subtype !== asset.facilitySpecs.subtype) {
        context.addIssue({ code: "custom", path: ["facilitySpecs", "visualProfile"], message: "Profil visual tidak sesuai jenis PAC." });
    }
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
    const profile = specs?.visualProfile === "apc-20kva" ? UPS_PROFILES[specs.visualProfile] : specs?.visualProfile ? PAC_PROFILES[specs.visualProfile] : null;
    const widthMm = specs?.widthMm ?? profile?.widthMm;
    const depthMm = specs?.depthMm ?? profile?.depthMm;
    const heightMm = specs?.heightMm ?? profile?.heightMm;
    // Generic display proportions, never persisted as measured specifications.
    const fallback = asset.assetType === "ups" ? [0.6, 0.8, 1.5] : specs?.subtype === "in-row" ? [0.3, 1.07, 2] : [1.2, 0.9, 2];
    return {
        width: widthMm != null ? widthMm / 1000 : fallback[0],
        depth: depthMm != null ? depthMm / 1000 : fallback[1],
        height: heightMm != null ? heightMm / 1000 : fallback[2],
        estimated: widthMm == null || depthMm == null || heightMm == null,
        footprintEstimated: widthMm == null || depthMm == null,
        heightEstimated: heightMm == null,
    };
}

export function facilityLabel(assetType: string, specs?: FacilitySpecs | null) {
    if (assetType === "ups") return "UPS floor-standing";
    if (assetType === "pac") return specs?.subtype === "in-row" ? "PAC in-row" : "PAC top-blow";
    return "Standard";
}
