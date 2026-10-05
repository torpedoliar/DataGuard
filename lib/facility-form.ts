import { facilityAssetSchema, type FacilityAsset } from "./facility-asset";

export function parseFacilityForm(form: FormData, existing?: FacilityAsset) {
    const text = form.get("facilityAsset");
    if (text === null) return existing ?? null;
    if (typeof text !== "string") throw new Error("Data fasilitas tidak valid.");
    try { return facilityAssetSchema.parse(JSON.parse(text)); }
    catch { throw new Error("Periksa spesifikasi dan penempatan fasilitas."); }
}
