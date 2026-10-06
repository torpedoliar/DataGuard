"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import dynamic from "next/dynamic";
import type { SceneRack } from "@/lib/rack-filter";
import type { RackDevice } from "@/actions/rack-layout";
const RackScene = dynamic(() => import("@/components/rack3d/rack-scene"), { ssr: false });
import { useRouter } from "next/navigation";
import { getRoomLayout, saveRoomLayout } from "@/actions/room-layout";
import { footprintCorners, validateRoomLayout, type Footprint } from "@/lib/room-layout";

type Loaded = Extract<Awaited<ReturnType<typeof getRoomLayout>>, { success: true }>;
export type LayoutAsset = Loaded["assets"][number];

export function FloorPlacementPreview({ assets, width, depth, selectedKey, onMove, floorPlanPath, snap = true }: {
    assets: LayoutAsset[]; width: number; depth: number; selectedKey?: string | null;
    onMove?: (key: string, x: number, z: number) => void; floorPlanPath?: string | null; snap?: boolean;
}) {
    const [dragging, setDragging] = useState<{ key: string; offsetX: number; offsetZ: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const validWidth = Math.max(width, 1), validDepth = Math.max(depth, 1);
    const step = snap ? 0.1 : 0.001;
    return <div className="space-y-2">
        <div className="flex gap-2 text-xs"><button type="button" onClick={() => setZoom((v) => Math.min(4, v + 0.25))}>Zoom +</button><button type="button" onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}>Zoom −</button><button type="button" onClick={() => setZoom(1)}>Fit room</button><span>Grid 1 m · depan ditandai garis putih</span></div>
        <div className="max-h-[60vh] overflow-auto rounded border border-ops-border bg-ops-bg">
            <svg role="img" aria-label="Denah ruangan dalam meter" viewBox={`0 0 ${validWidth} ${validDepth}`} style={{ width: `${zoom * 100}%`, minWidth: 280, touchAction: "none" }}
                onPointerMove={(event) => {
                    if (!dragging || !onMove) return;
                    const point = event.currentTarget.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
                    const matrix = event.currentTarget.getScreenCTM(); if (!matrix) return;
                    const p = point.matrixTransform(matrix.inverse());
                    onMove(dragging.key, Math.round((p.x - dragging.offsetX) / step) * step, Math.round((p.y - dragging.offsetZ) / step) * step);
                }} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
                <defs><pattern id="room-layout-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#64748b" strokeWidth="0.015" /></pattern></defs>
                <rect width={validWidth} height={validDepth} fill="#0f172a" />
                {floorPlanPath && <image href={floorPlanPath} width={validWidth} height={validDepth} preserveAspectRatio="xMidYMid meet" opacity="0.6" />}
                <rect width={validWidth} height={validDepth} fill="url(#room-layout-grid)" />
                {assets.map((asset) => {
                    if (asset.x === null || asset.z === null) return null;
                    const points = footprintCorners({ ...asset, x: asset.x, z: asset.z, rotation: asset.rotation ?? 0 });
                    return <g key={asset.key} onPointerDown={(event) => { if (!onMove) return; event.stopPropagation(); const svg = event.currentTarget.ownerSVGElement; const matrix = svg?.getScreenCTM(); if (!svg || !matrix) return; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const p = point.matrixTransform(matrix.inverse()); svg.setPointerCapture(event.pointerId); setDragging({ key: asset.key, offsetX: p.x - asset.x!, offsetZ: p.y - asset.z! }); }} style={{ cursor: onMove ? "grab" : "default" }}>
                        <polygon points={points.map((p) => `${p.x},${p.z}`).join(" ")} fill={asset.kind === "rack" ? "#475569" : asset.kind === "pac" ? "#0369a1" : "#92400e"} stroke={selectedKey === asset.key ? "#f8fafc" : "#94a3b8"} strokeWidth="0.04" />
                        <line x1={points[2].x} y1={points[2].z} x2={points[3].x} y2={points[3].z} stroke="#ffffff" strokeWidth="0.07" />
                        <text x={asset.x} y={asset.z} textAnchor="middle" dominantBaseline="middle" fontSize="0.16" fill="white" pointerEvents="none">{asset.name}</text>
                    </g>;
                })}
            </svg>
        </div>
    </div>;
}

export default function RoomLayoutEditor({ roomId, onClose }: { roomId: number; onClose: () => void }) {
    const router = useRouter();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [assets, setAssets] = useState<LayoutAsset[]>([]);
    const [size, setSize] = useState({ width: 10, depth: 8, height: 3.2 });
    const [selected, setSelected] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [preview3d, setPreview3d] = useState(false);
    const [snap, setSnap] = useState(true);
    const [acknowledged, setAcknowledged] = useState(false);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState("");
    useEffect(() => {
        let alive = true;
        getRoomLayout(roomId).then((result) => {
            if (!alive) return;
            if (!result.success) { setMessage(result.message); return; }
            const placed = result.assets.filter((a) => a.x !== null && a.z !== null);
            const shiftX = result.room.layoutMode === "legacy" ? 2 - Math.min(0, ...placed.map((a) => a.x! - a.width / 2)) : 0;
            const shiftZ = result.room.layoutMode === "legacy" ? 2 - Math.min(0, ...placed.map((a) => a.z! - a.depth / 2)) : 0;
            const translated = result.assets.map((a) => ({ ...a, x: a.x === null ? null : a.x + shiftX, z: a.z === null ? null : a.z + shiftZ }));
            setLoaded(result); setAssets(translated);
            setSize({ width: result.room.roomWidthM ?? Math.max(10, ...translated.map((a) => (a.x ?? 0) + a.width / 2 + 2)), depth: result.room.roomDepthM ?? Math.max(8, ...translated.map((a) => (a.z ?? 0) + a.depth / 2 + 2)), height: result.room.roomHeightM ?? 3.2 });
        }).catch(() => { if (alive) setMessage("Gagal memuat layout."); });
        return () => { alive = false; };
    }, [roomId]);
    const change = (key: string, patch: Partial<Pick<LayoutAsset, "x" | "z" | "rotation">>) => { setAssets((all) => all.map((a) => a.key === key ? { ...a, ...patch } : a)); setDirty(true); };
    const current = assets.find((a) => a.key === selected);
    const validation = validateRoomLayout(size, assets.flatMap((a): Footprint[] => a.x === null || a.z === null ? [] : [{ ...a, x: a.x, z: a.z, rotation: a.rotation ?? 0 }]));
    const close = () => { if (!pending && (!dirty || window.confirm("Batal dan buang perubahan layout yang belum disimpan?"))) onClose(); };
    const save = async () => {
        if (!loaded || pending || validation.errors.length || (validation.warnings.length && !acknowledged)) return;
        setPending(true); setMessage("");
        try {
            const result = await saveRoomLayout({ siteId: loaded.siteId, roomId, revision: loaded.room.layoutRevision, ...size, acknowledgeEstimated: acknowledged, assets: assets.map(({ key, x, z, rotation }) => ({ key, x, z, rotation })) });
            if (result.success) { router.refresh(); onClose(); } else setMessage(result.message);
        } catch { setMessage("Gagal menyimpan. Periksa koneksi sebelum mencoba kembali."); } finally { setPending(false); }
    };
    const saveReason = !loaded ? "Menunggu data ruangan." : pending ? "Sedang menyimpan…" : validation.errors.length ? "Perbaiki error layout sebelum menyimpan." : validation.warnings.length && !acknowledged ? "Centang konfirmasi ukuran generik di bawah agar Simpan aktif." : "Layout siap disimpan.";
    return <Modal open title="Atur layout ruangan" onClose={close} hideCloseButton={pending} backdropClassName="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" panelClassName="max-h-[90vh] w-full max-w-5xl flex flex-col overflow-hidden rounded-lg border border-ops-border bg-ops-surface" bodyClassName="min-h-0 overflow-y-auto p-5 space-y-4" footer={<div className="space-y-2">
        {loaded && validation.warnings.length > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1 shrink-0" /> Saya memahami ukuran generik/parsial; clearance fisik belum terverifikasi.</label>}
        <p role="status" className="text-xs text-ops-muted">{message || saveReason}</p>
        <div className="flex justify-end gap-3"><button type="button" disabled={pending} onClick={close}>Batal</button><button type="button" className="rounded bg-ops-accent px-4 py-2 font-semibold text-ops-bg disabled:opacity-40" disabled={!loaded || pending || validation.errors.length > 0 || (validation.warnings.length > 0 && !acknowledged)} onClick={save}>{pending ? "Menyimpan…" : "Simpan Layout"}</button></div>
    </div>}>
        <div className="flex justify-between"><h2 className="font-bold">Atur Layout Ruangan {loaded?.room.name}</h2><button type="button" onClick={close} disabled={pending}>Tutup</button></div>
        {!loaded ? <p role="status">{message || "Memuat layout…"}</p> : <>
            {loaded.room.layoutMode === "legacy" && <p className="text-sm">Ukuran awal merupakan saran. Periksa ukuran nyata sebelum Simpan; layout lama tidak berubah sampai disimpan.</p>}
            <div className="flex flex-wrap gap-3">{(["width", "depth", "height"] as const).map((field) => <label key={field} className="text-xs">{field === "width" ? "Lebar" : field === "depth" ? "Panjang" : "Tinggi"} (m)<input type="number" min="0.1" step="0.1" value={size[field]} onChange={(e) => { setSize((s) => ({ ...s, [field]: Number(e.target.value) })); setDirty(true); }} className="ops-input block w-28 p-2" /></label>)}<label className="text-sm self-end"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap 0,1 m</label></div>
            <p className="text-xs text-ops-muted">Origin kiri atas (0,0). X lebar, Z panjang. Gambar denah referensi, bukan kalibrasi ukuran.</p>
            <div className="grid gap-4 md:grid-cols-[1fr_16rem]"><FloorPlacementPreview assets={assets} {...size} floorPlanPath={loaded.room.floorPlanPath} selectedKey={selected} snap={snap} onMove={(key, x, z) => { setSelected(key); change(key, { x, z }); }} />
                <div className="space-y-3"><label className="block text-sm">Aset<select className="ops-input block w-full p-2" value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)}><option value="">Pilih aset</option>{assets.map((a) => <option key={a.key} value={a.key}>{a.name}{a.x === null ? " · Belum ditempatkan" : ""}</option>)}</select></label>
                    {current && <><p className="text-xs">{current.estimated ? "Ukuran model generik/parsial; clearance belum terverifikasi." : "Ukuran terdokumentasi."}</p>{current.x === null ? <button type="button" onClick={() => change(current.key, { x: size.width / 2, z: size.depth / 2, rotation: 0 })}>Tempatkan</button> : <>
                        {(["x", "z", "rotation"] as const).map((field) => <label key={field} className="block text-xs">{field === "rotation" ? "Rotasi (°)" : `${field.toUpperCase()} (m)`}<input className="ops-input block w-full p-2" type="number" step={field === "rotation" ? 1 : 0.1} value={current[field] ?? 0} onChange={(e) => change(current.key, { [field]: Number(e.target.value) })} /></label>)}
                        <div className="flex gap-3 text-sm"><button type="button" onClick={() => change(current.key, { rotation: ((current.rotation ?? 0) + 90) % 360 })}>Putar 90°</button><button type="button" onClick={() => change(current.key, { x: null, z: null, rotation: null })}>Lepas penempatan</button></div></> }</>}
                </div></div>
            <button type="button" className="rounded border border-ops-border px-3 py-2 text-sm" onClick={() => setPreview3d(!preview3d)}>{preview3d ? "Tutup preview 3D" : "Preview 3D draft"}</button>
            {preview3d && <div className="relative h-80"><RackScene racks={loaded.sourceRacks.map((r): SceneRack => {
                const placement = assets.find((a) => a.key === `rack:${r.id}`)!;
                return { ...r, totalU: r.totalU ?? 42, locationName: loaded.room.name, devices: [], occupiedU: [], hasMatchingDevices: true, dimmed: false, layoutMode: "manual", floorX: placement.x, floorZ: placement.z, floorRotation: placement.rotation };
            })} facilities={loaded.sourceFacilities.map((d): RackDevice => {
                const placement = assets.find((a) => a.key === `device:${d.id}`)!;
                return { ...d, floorX: placement.x, floorZ: placement.z, floorRotation: placement.rotation, brandName: null, brandLogo: null, categoryName: d.assetType === "pac" ? "Cooling" : "Power", categoryColor: null, locationName: loaded.room.name, ports: [], openIncidents: { count: 0, maxSeverity: null } };
            })} roomSettings={{ layoutMode: "manual", roomWidthM: size.width, roomDepthM: size.depth, roomHeightM: size.height, floorPlanPath: loaded.room.floorPlanPath, tempC: null, tempThresholdC: null, appearance: loaded.appearance }} floorPlanUrl={loaded.room.floorPlanPath} qualitySetting="medium" focusRack={null} onFocusRack={() => {}} showFree={false} selectedDeviceId={null} focusDeviceId={null} onSelectDevice={() => {}} temp={null} colorBy="category" appearance={loaded.appearance} /></div>}
            {validation.errors.map((error) => <p role="alert" key={error} className="text-sm text-ops-danger">{error}</p>)}
            {validation.warnings.map((warning) => <p key={warning} className="text-xs text-ops-warning">{warning}</p>)}
        </>}
    </Modal>;
}
