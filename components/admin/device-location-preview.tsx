"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { getDeviceProfile } from "@/actions/device-profile";
import ActionButton from "@/components/ui/action-button";
import { FloorPlacementPreview, type LayoutAsset } from "./room-layout-editor";
import { facilityDimensions } from "@/lib/facility-asset";
import { DEFAULT_APPEARANCE } from "@/lib/room-appearance";
import { layoutRacks } from "@/components/rack3d/layout";
import { inRack } from "@/components/rack3d/free-slots";
import { RACK_W, RACK_D, rackHeight } from "@/components/rack3d/constants";
const PeerRackMini = dynamic(() => import("@/components/rack3d/peer-rack-mini"), { ssr: false });
const RackScene = dynamic(() => import("@/components/rack3d/rack-scene"), { ssr: false });
type Profile = NonNullable<Awaited<ReturnType<typeof getDeviceProfile>>>;

export default function DeviceLocationPreview({ profile, onViewChange }: { profile: Profile; onViewChange?: (view: "2d" | "3d") => void }) {
    const [view, setView] = useState<"2d" | "3d">("2d");
    const { device, rack, visualDevice, room } = profile;
    const facilities: LayoutAsset[] = profile.facilities.map((d) => ({ key: `device:${d.id}`, name: d.name, kind: d.assetType ?? "standard", x: d.floorX ?? null, z: d.floorZ ?? null, rotation: d.floorRotation ?? null, ...facilityDimensions({ assetType: d.assetType!, facilitySpecs: d.facilitySpecs ?? null }) }));
    const roomCabinets: LayoutAsset[] = layoutRacks(profile.roomRacks).map((p) => ({ key: `rack:${p.rack.id}`, name: p.rack.name, kind: "rack", x: p.x, z: p.z, rotation: p.rotationY * 180 / Math.PI, width: RACK_W, depth: RACK_D, height: rackHeight(p.rack.totalU), estimated: true }));
    const roomAssets = [...roomCabinets, ...facilities];
    const shiftX = room?.layoutMode === "manual" ? 0 : 1 - Math.min(0, ...roomAssets.map((a) => (a.x ?? 0) - a.width / 2));
    const shiftZ = room?.layoutMode === "manual" ? 0 : 1 - Math.min(0, ...roomAssets.map((a) => (a.z ?? 0) - a.depth / 2));
    const previewAssets = roomAssets.map((a) => ({ ...a, x: a.x == null ? null : a.x + shiftX, z: a.z == null ? null : a.z + shiftZ }));
    const sceneRack = rack ? { ...rack, dimmed: false, hasMatchingDevices: true, devices: rack.devices.map((d) => ({ ...d, isMuted: false })) } : null;
    const invalidRackPosition = rack && !inRack(device, rack.totalU);
    const placed = (rack && !invalidRackPosition) || (device.floorX != null && device.floorZ != null);
    return <section className="rounded-lg border border-ops-border bg-ops-surface p-4 space-y-3"><h3 className="font-semibold">{device.assetType === "standard" ? "Rack location" : "Room location"}</h3><p className="text-xs text-ops-muted">{device.locationName ?? "Unassigned"} · {rack?.name ?? (device.floorX == null ? "Unplaced" : `X ${device.floorX} / Z ${device.floorZ} m`)}</p>
        {invalidRackPosition && <p role="alert" className="text-xs text-ops-warning">Posisi U belum valid atau melebihi kapasitas rack.</p>}
        {placed && <div className="flex gap-2"><ActionButton size="sm" variant={view === "2d" ? "primary" : "secondary"} onClick={() => { setView("2d"); onViewChange?.("2d"); }}>2D</ActionButton><ActionButton size="sm" variant={view === "3d" ? "primary" : "secondary"} onClick={() => { setView("3d"); onViewChange?.("3d"); }}>3D</ActionButton></div>}
        {view === "3d" && placed ? <div className="h-80">{sceneRack ? <PeerRackMini rack={sceneRack} peerId={device.id} /> : <RackScene racks={profile.roomRacks.map((r) => ({ ...r, dimmed: false, hasMatchingDevices: true, devices: r.devices.map((d) => ({ ...d, isMuted: false })) }))} facilities={profile.facilities} roomSettings={room ?? undefined} floorPlanUrl={room?.floorPlanPath ?? null} qualitySetting="medium" focusRack={null} onFocusRack={() => {}} selectedDeviceId={device.id} focusDeviceId={device.id} onSelectDevice={() => {}} showFree={false} temp={null} colorBy="category" appearance={room?.appearance ?? DEFAULT_APPEARANCE} />}</div> : rack ? <div className="max-h-96 overflow-y-auto rounded border border-ops-border bg-ops-bg p-2">{Array.from({ length: rack.totalU }, (_, i) => rack.totalU - i).map((u) => {
            const occupant = rack.devices.find((d) => d.rackPosition != null && u >= d.rackPosition && u < d.rackPosition + (d.uHeight ?? 1));
            return <div key={u} style={occupant && occupant.id !== device.id ? { borderLeft: `3px solid ${occupant.categoryColor ?? "#64748b"}` } : undefined} className={`flex h-6 items-center gap-2 border-b border-ops-border text-[10px] ${occupant?.id === device.id ? "bg-ops-accent/20 text-ops-accent font-bold" : "text-ops-muted"}`}><span className="w-8">U{u}</span><span className="truncate">{occupant?.name ?? "Available"}</span></div>;
        })}</div> : placed && visualDevice ? <FloorPlacementPreview assets={previewAssets} width={room?.roomWidthM ?? Math.max(10, ...previewAssets.map((a) => (a.x ?? 0) + a.width / 2 + 1))} depth={room?.roomDepthM ?? Math.max(8, ...previewAssets.map((a) => (a.z ?? 0) + a.depth / 2 + 1))} selectedKey={`device:${device.id}`} floorPlanPath={room?.floorPlanPath} /> : <p className="text-sm text-ops-muted">Belum memiliki penempatan yang terdokumentasi.</p>}
        <Link href={`/admin/rack?deviceId=${device.id}`} className="text-xs font-semibold text-ops-accent underline">Lihat Ruangan / Atur Layout</Link>
    </section>;
}
