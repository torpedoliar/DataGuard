"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useRouter } from "next/navigation";
import { convertFacilityDevice } from "@/actions/facility-assets";
import { getRoomLayout } from "@/actions/room-layout";
import { facilityAssetSchema, facilityDimensions, facilityLabel, type FacilityAsset } from "@/lib/facility-asset";
import type { FacilityConversionInput } from "@/lib/facility-conversion";
import FacilitySpecFields, { emptyFacility } from "./facility-spec-fields";
import { FloorPlacementPreview, type LayoutAsset } from "./room-layout-editor";

type ExistingDevice = FacilityConversionInput["original"] & { id: number; name: string };
export default function FacilityConversionWizard({ devices, locations, initialDeviceId, onClose }: {
    devices: ExistingDevice[]; locations: { id: number; name: string }[]; initialDeviceId?: number; onClose: () => void;
}) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [deviceId, setDeviceId] = useState(initialDeviceId ?? devices[0]?.id ?? 0);
    const [asset, setAsset] = useState<FacilityAsset>(() => emptyFacility("in-row"));
    const [room, setRoom] = useState<Extract<Awaited<ReturnType<typeof getRoomLayout>>, { success: true }> | null>(null);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState("");
    const [acknowledged, setAcknowledged] = useState(false);
    const device = devices.find((d) => d.id === deviceId);
    const preview: LayoutAsset = { key: `device:${deviceId}`, name: device?.name ?? "PAC/UPS", kind: asset.assetType, ...facilityDimensions(asset), x: asset.floorX, z: asset.floorZ, rotation: asset.floorRotation };
    const next = () => {
        if (step === 0 && !device) { setMessage("Pilih perangkat."); return; }
        if (step >= 1 && !facilityAssetSchema.safeParse(asset).success) { setMessage("Periksa spesifikasi dan penempatan."); return; }
        if (step === 2 && (!room || room.room.id !== asset.locationId)) { setMessage("Pilih ruangan site aktif."); return; }
        setMessage(""); setStep((s) => s + 1);
    };
    return <Modal open title="Konversi PAC/UPS" onClose={() => { if (!pending) onClose(); }} hideCloseButton={pending} backdropClassName="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" panelClassName="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-ops-border bg-ops-surface" bodyClassName="p-5 space-y-4">
        <h2 className="font-bold">Konversi PAC/UPS · {step + 1}/4</h2>
        {step === 0 && <><label className="block text-sm">Device existing<select className="ops-input block w-full p-2" value={deviceId} onChange={(e) => setDeviceId(Number(e.target.value))}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><p className="text-sm">{device?.rackName ?? "Tanpa rack"} {device?.rackPosition != null ? `U${device.rackPosition} / ${device.uHeight}U` : ""}. ID, foto, IP, port dan riwayat tetap.</p></>}
        {step === 1 && <FacilitySpecFields asset={asset} onChange={setAsset} />}
        {step === 2 && <>
            <label className="block text-sm">Ruangan<select className="ops-input block w-full p-2" value={asset.locationId ?? ""} disabled={pending} onChange={async (e) => {
                const id = Number(e.target.value); setAsset((a) => ({ ...a, locationId: id || null, floorX: null, floorZ: null, floorRotation: null })); setRoom(null);
                if (!id) return;
                setPending(true);
                try { const result = await getRoomLayout(id); if (result.success) setRoom(result); else setMessage(result.message); } catch { setMessage("Gagal memuat ruangan."); } finally { setPending(false); }
            }}><option value="">Pilih ruangan</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="text-sm"><input type="checkbox" checked={asset.floorX === null} onChange={(e) => setAsset((a) => ({ ...a, floorX: e.target.checked ? null : 2, floorZ: e.target.checked ? null : 2, floorRotation: e.target.checked ? null : 0 }))} /> Unplaced</label>
            {room && <FloorPlacementPreview assets={[...room.assets, preview]} width={room.room.roomWidthM ?? 10} depth={room.room.roomDepthM ?? 8} selectedKey={preview.key} floorPlanPath={room.room.floorPlanPath} onMove={(key, x, z) => { if (key === preview.key) setAsset((a) => ({ ...a, floorX: x, floorZ: z, floorRotation: a.floorRotation ?? 0 })); }} />}
            {asset.floorX !== null && <div className="flex flex-wrap gap-3">{(["floorX", "floorZ", "floorRotation"] as const).map((key) => <label key={key} className="text-xs">{key === "floorRotation" ? "Rotasi (°)" : key === "floorX" ? "X (m)" : "Z (m)"}<input className="ops-input block w-28 p-2" type="number" step="0.1" value={asset[key] ?? 0} onChange={(e) => setAsset((a) => ({ ...a, [key]: Number(e.target.value) }))} /></label>)}</div>}
            <p className="text-xs text-ops-muted">Posisi baru hanya tersimpan saat konfirmasi konversi. Aset lain tidak dipindahkan.</p>
        </>}
        {step === 3 && <><p>{device?.name} · ID {deviceId} tetap</p><p>{device?.rackName ?? "Tanpa rack"} / U{device?.rackPosition ?? "-"} dilepas. {facilityLabel(asset.assetType, asset.facilitySpecs)} · {asset.assetType === "pac" ? "Cooling" : "Power"}.</p><p>{room?.room.name} · {asset.floorX === null ? "Unplaced" : `X ${asset.floorX} m / Z ${asset.floorZ} m / ${asset.floorRotation}°`}</p><p className="text-sm">Foto, IP, port, PIC, audit dan incident tidak dihapus. Rack asal tetap ada.</p><label className="block text-sm"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> Konfirmasi konversi; ukuran model generik/parsial dan clearance fisik belum terverifikasi.</label></>}
        {message && <p role="alert" className="text-sm text-ops-danger">{message}</p>}
        <div className="flex justify-end gap-4"><button type="button" disabled={pending} onClick={onClose}>Batal</button>{step > 0 && <button type="button" disabled={pending} onClick={() => setStep((s) => s - 1)}>Kembali</button>}{step < 3 ? <button type="button" disabled={pending} onClick={next}>Lanjut</button> : <button type="button" disabled={pending || !acknowledged} onClick={async () => {
            if (!device || !room) return; setPending(true);
            try { const { assetType, categoryId, locationId, rackName, rackPosition, uHeight } = device;
                const result = await convertFacilityDevice({ siteId: room.siteId, deviceId, original: { assetType, categoryId, locationId, rackName, rackPosition, uHeight }, asset, roomRevision: room.room.layoutRevision, acknowledgeEstimated: acknowledged });
                if (result.success) { router.refresh(); onClose(); } else setMessage(result.message);
            } catch { setMessage("Gagal menyimpan konversi. Muat ulang sebelum mencoba kembali."); } finally { setPending(false); }
        }}>{pending ? "Menyimpan…" : "Konfirmasi Konversi"}</button>}</div>
    </Modal>;
}
