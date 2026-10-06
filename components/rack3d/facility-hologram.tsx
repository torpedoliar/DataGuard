"use client";

import type { RackDevice } from "@/actions/rack-layout";
import { facilityDimensions, facilityLabel } from "@/lib/facility-asset";
import { useDeviceDrawer } from "@/components/admin/device-drawer-sections";

export function FacilityHologram({ device, drawerState, onClose, onOpenPanel, onToggleCabinet, cabinetOpen = false }: {
    device: RackDevice; drawerState: ReturnType<typeof useDeviceDrawer>; onClose: () => void; onOpenPanel: () => void;
    onToggleCabinet?: () => void; cabinetOpen?: boolean;
}) {
    const specs = device.facilitySpecs;
    const dimensions = facilityDimensions({ assetType: device.assetType ?? "standard", facilitySpecs: specs ?? null });
    return <section aria-label="Facility information" className="w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-ops-border bg-ops-surface/95 p-3 text-xs text-ops-text shadow-xl" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="flex justify-between gap-2"><strong>{device.name}</strong><button type="button" aria-label="Close facility information" onClick={onClose}>×</button></div>
        <div className="my-2 max-h-60 overflow-y-auto space-y-1">
            <p>{facilityLabel(device.assetType!, specs)} · {device.locationName ?? "Unassigned"}</p>
            <p>Model: {specs?.model ?? "Belum diketahui"}</p>
            <p>W/D/H: {dimensions.width} / {dimensions.depth} / {dimensions.height} m</p>
            <p className="text-ops-muted">{specs?.visualProfile === "apc-20kva" ? "Ukuran referensi perkiraan" : dimensions.estimated ? "Ukuran generik/parsial" : "Ukuran input/referensi profil"}</p>
            {specs?.subtype === "floor-standing" ? <><p>UPS: {specs.capacityKva ?? "?"} kVA / {specs.ratedKw ?? "?"} kW</p><p>Battery: {specs.battery}</p></> : specs && <><p>Cooling: {specs.coolingKw ?? "?"} kW</p><p>Supply airflow: {specs.supplyAirflow ?? "Belum diketahui"}</p></>}
            <p>Status audit: {device.status ?? "Pending"}</p><p>IP management: {device.ipAddress ?? "Tidak didokumentasikan"}</p>
            {drawerState.loading ? <p role="status">Memuat audit/PIC/incident…</p> : drawerState.error ? <p role="alert">Gagal memuat detail.</p> : drawerState.data && <><p>Audit terakhir: {drawerState.data.lastAudit ? `${drawerState.data.lastAudit.checkDate} · ${drawerState.data.lastAudit.status}` : "Belum diaudit"}</p><p>PIC: {drawerState.data.picGroups.map((g) => g.name).join(", ") || "-"}</p><p>Incident terbuka: {drawerState.data.incidents.length}</p></>}
        </div>
        <div className="flex gap-3 border-t border-ops-border pt-2"><button type="button" onClick={onOpenPanel}>Panel Detail</button>{onToggleCabinet && <button type="button" aria-pressed={cabinetOpen} onClick={onToggleCabinet}>{cabinetOpen ? "Tutup PAC" : "Buka PAC"}</button>}</div>
        {onToggleCabinet && <p className="mt-1 text-[10px] text-ops-muted">Interior visual, bukan status operasi live.</p>}
    </section>;
}
