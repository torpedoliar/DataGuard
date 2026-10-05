"use client";

import { facilityAssetSchema, type FacilityAsset, type FacilitySpecs } from "@/lib/facility-asset";

export const emptyFacility = (kind: "in-row" | "top-blow" | "floor-standing"): FacilityAsset => facilityAssetSchema.parse({
    assetType: kind === "floor-standing" ? "ups" : "pac", facilitySpecs: { subtype: kind }, locationId: null, floorX: null, floorZ: null, floorRotation: null,
});

export default function FacilitySpecFields({ asset, onChange, fixedType = false }: { asset: FacilityAsset; onChange: (asset: FacilityAsset) => void; fixedType?: boolean }) {
    const set = (field: string, value: string | number | null) => onChange({ ...asset, facilitySpecs: { ...asset.facilitySpecs, [field]: value } as FacilitySpecs } as FacilityAsset);
    const specs = asset.facilitySpecs;
    return <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Jenis<select className="ops-input block w-full p-2" value={specs.subtype} onChange={(e) => {
            const next = emptyFacility(e.target.value as "in-row" | "top-blow" | "floor-standing");
            const common = { model: specs.model, serialNumber: specs.serialNumber, widthMm: specs.widthMm, depthMm: specs.depthMm, heightMm: specs.heightMm, installedOn: specs.installedOn, maintainedOn: specs.maintainedOn, coverageNotes: specs.coverageNotes };
            onChange({ ...next, locationId: asset.locationId, floorX: asset.floorX, floorZ: asset.floorZ, floorRotation: asset.floorRotation, facilitySpecs: { ...next.facilitySpecs, ...common } } as FacilityAsset);
        }}>{(!fixedType || asset.assetType === "pac") && <><option value="in-row">PAC in-row</option><option value="top-blow">PAC top-blow</option></>}{(!fixedType || asset.assetType === "ups") && <option value="floor-standing">UPS floor-standing</option>}</select></label>
        {(["model", "serialNumber", "widthMm", "depthMm", "heightMm", "installedOn", "maintainedOn"] as const).map((key) => <label key={key} className="text-xs">{{ model: "Model", serialNumber: "Serial number", widthMm: "Lebar (mm)", depthMm: "Kedalaman (mm)", heightMm: "Tinggi (mm)", installedOn: "Tanggal instalasi", maintainedOn: "Tanggal maintenance" }[key]}<input className="ops-input block w-full p-2" type={key.endsWith("Mm") ? "number" : key.endsWith("On") ? "date" : "text"} min="1" value={specs[key] ?? ""} onChange={(e) => set(key, e.target.value === "" ? null : key.endsWith("Mm") ? Number(e.target.value) : e.target.value)} /></label>)}
        {specs.subtype === "floor-standing" ? <>
            {(["capacityKva", "ratedKw"] as const).map((key) => <label key={key} className="text-xs">{key === "capacityKva" ? "Kapasitas (kVA)" : "Rated power (kW), bukan otomatis dari kVA"}<input className="ops-input block w-full p-2" type="number" min="0.01" step="0.01" value={specs[key] ?? ""} onChange={(e) => set(key, e.target.value ? Number(e.target.value) : null)} /></label>)}
            <label className="text-xs">Battery<select className="ops-input block w-full p-2" value={specs.battery} onChange={(e) => set("battery", e.target.value)}><option value="unknown">Belum diketahui</option><option value="internal">Internal</option><option value="external">External</option></select></label>
        </> : <>
            <label className="text-xs">Cooling capacity (kW)<input className="ops-input block w-full p-2" type="number" min="0.01" step="0.01" value={specs.coolingKw ?? ""} onChange={(e) => set("coolingKw", e.target.value ? Number(e.target.value) : null)} /></label>
            <label className="text-xs">Supply airflow<select className="ops-input block w-full p-2" value={specs.supplyAirflow ?? ""} onChange={(e) => set("supplyAirflow", e.target.value || null)}><option value="">Belum diketahui</option>{["front", "rear", "top", "bottom"].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        </>}
        <label className="text-xs sm:col-span-2">Coverage notes<textarea className="ops-input block w-full p-2" maxLength={2000} value={specs.coverageNotes ?? ""} onChange={(e) => set("coverageNotes", e.target.value || null)} /></label>
        <p className="text-xs text-ops-muted sm:col-span-2">Kosong = belum diketahui. Model visual generik bukan spesifikasi manufacturer.</p>
    </div>;
}
