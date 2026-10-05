import { z } from "zod";
import { facilityAssetSchema } from "./facility-asset";

export const conversionSchema = z.object({
    siteId: z.number().int().positive(),
    deviceId: z.number().int().positive(),
    original: z.object({
        assetType: z.literal("standard"),
        categoryId: z.number().int().positive(),
        locationId: z.number().int().positive().nullable(),
        rackName: z.string().nullable(),
        rackPosition: z.number().nullable(),
        uHeight: z.number().nullable(),
    }),
    asset: facilityAssetSchema,
    roomRevision: z.number().int().nonnegative().nullable(),
    acknowledgeEstimated: z.boolean().default(false),
});
export type FacilityConversionInput = z.infer<typeof conversionSchema>;

export function matchesConversionOriginal(current: FacilityConversionInput["original"], original: FacilityConversionInput["original"]) {
    return (Object.keys(original) as (keyof typeof original)[]).every((key) => current[key] === original[key]);
}
