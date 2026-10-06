"use client";

import { facilityAssetSchema, facilityDimensions, PAC_PROFILES, UPS_PROFILES, type FacilityAsset, type FacilitySpecs } from "@/lib/facility-asset";

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
        {asset.assetType === "pac" && <label className="text-xs">Profil model 3D<select className="ops-input block w-full p-2" value={asset.facilitySpecs.visualProfile ?? ""} onChange={(event) => {
            const key = event.target.value as keyof typeof PAC_PROFILES;
            if (!key) { set("visualProfile", null); return; }
            const profile = PAC_PROFILES[key];
            onChange({ ...asset, facilitySpecs: { ...asset.facilitySpecs, visualProfile: key, subtype: profile.subtype, model: profile.label, widthMm: profile.widthMm, depthMm: profile.depthMm, heightMm: profile.heightMm } });
        }}><option value="">Generic / model lain</option>{Object.entries(PAC_PROFILES).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}</select><span className="mt-1 block text-ops-muted">Memilih profil mengisi ukuran referensi dalam mm. Device existing tidak perlu dikonversi ulang.</span></label>}
        {asset.assetType === "ups" && <label className="text-xs">Profil UPS 3D<select className="ops-input block w-full p-2" value={asset.facilitySpecs.visualProfile ?? ""} onChange={(event) => {
            if (!event.target.value) { set("visualProfile", null); return; }
            const profile = UPS_PROFILES["apc-20kva"];
            onChange({ ...asset, facilitySpecs: { ...asset.facilitySpecs, visualProfile: "apc-20kva", model: "APC 20 kVA", widthMm: profile.widthMm, depthMm: profile.depthMm, heightMm: profile.heightMm, capacityKva: 20 } });
        }}><option value="">Generic / model lain</option><option value="apc-20kva">APC 20 kVA</option></select><span className="block mt-1 text-ops-muted">Referensi sekitar W520 × D840 × H1490 mm. Konfirmasi ukuran unit; kW/battery tidak diasumsikan.</span></label>}
        {(["model", "serialNumber", "widthMm", "depthMm", "heightMm", "installedOn", "maintainedOn"] as const).map((key) => <label key={key} className="text-xs">{{ model: "Model", serialNumber: "Serial number", widthMm: "Lebar (mm)", depthMm: "Kedalaman (mm)", heightMm: "Tinggi (mm)", installedOn: "Tanggal instalasi", maintainedOn: "Tanggal maintenance" }[key]}<input className="ops-input block w-full p-2" type={key.endsWith("Mm") ? "number" : key.endsWith("On") ? "date" : "text"} min="1" value={specs[key] ?? ""} onChange={(e) => set(key, e.target.value === "" ? null : key.endsWith("Mm") ? Number(e.target.value) : e.target.value)} /></label>)}
        {specs.subtype === "floor-standing" ? <>
            {(["capacityKva", "ratedKw"] as const).map((key) => <label key={key} className="text-xs">{key === "capacityKva" ? "Kapasitas (kVA)" : "Rated power (kW), bukan otomatis dari kVA"}<input className="ops-input block w-full p-2" type="number" min="0.01" step="0.01" value={specs[key] ?? ""} onChange={(e) => set(key, e.target.value ? Number(e.target.value) : null)} /></label>)}
            <label className="text-xs">Battery<select className="ops-input block w-full p-2" value={specs.battery} onChange={(e) => set("battery", e.target.value)}><option value="unknown">Belum diketahui</option><option value="internal">Internal</option><option value="external">External</option></select></label>
        </> : <>
            <label className="text-xs">Cooling capacity (kW)<input className="ops-input block w-full p-2" type="number" min="0.01" step="0.01" value={specs.coolingKw ?? ""} onChange={(e) => set("coolingKw", e.target.value ? Number(e.target.value) : null)} /></label>
            <label className="text-xs">Supply airflow<select className="ops-input block w-full p-2" value={specs.supplyAirflow ?? ""} onChange={(e) => set("supplyAirflow", e.target.value || null)}><option value="">Belum diketahui</option>{["front", "rear", "top", "bottom"].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        </>}
        <label className="text-xs sm:col-span-2">Coverage notes<textarea className="ops-input block w-full p-2" maxLength={2000} value={specs.coverageNotes ?? ""} onChange={(e) => set("coverageNotes", e.target.value || null)} /></label>
        <p className="text-xs text-ops-muted sm:col-span-2">Ukuran render W × D × H: {facilityDimensions(asset).width} × {facilityDimensions(asset).depth} × {facilityDimensions(asset).height} m. Kosong = belum diketahui, kecuali ukuran referensi profil. Detail visual mengikuti foto, bukan CAD manufacturer.</p>
        {asset.assetType === "pac" && specs.heightMm != null && specs.heightMm < 500 && <p role="alert" className="text-xs text-ops-warning sm:col-span-2">Tinggi cabinet kurang dari 500 mm. Periksa satuan: 2000 mm = 2 m, bukan 200 atau 2 mm.</p>}
    </div>;
}
