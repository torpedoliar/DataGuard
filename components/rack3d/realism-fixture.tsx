"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { SceneRack } from "@/lib/rack-filter";
import type { RackDevice } from "@/actions/rack-layout";
import { DEFAULT_APPEARANCE } from "@/lib/room-appearance";
import DeviceDetailPanel from "@/components/admin/device-detail-panel";
import type { Quality } from "./quality";
const RackScene = dynamic(() => import("./rack-scene"), { ssr: false });
const devices = ["Server", "Network", "Storage", "UPS", "Cooling"].map((kind, i) => ({
    id: i + 1, name: `Synthetic ${kind}`, brandName: null, brandLogo: null, categoryId: i, categoryName: kind, categoryColor: "#4f859c", locationName: "Synthetic room", photoPath: null, rackName: "Demo rack", rackPosition: 2 + i * 6, uHeight: i === 1 ? 1 : 2, zone: null, status: "OK", faceplatePortCount: i === 1 ? 24 : null, faceplateUplinkCount: i === 1 ? 4 : null, faceplateRows: 2, faceplateNumbering: "sequential", ports: [], isCritical: false, ipAddress: null, assetCode: null, openIncidents: { count: 0, maxSeverity: null }, isMuted: false,
}) as SceneRack["devices"][number]);
const peer = { ...devices[1], id: 6, name: "Synthetic peer", rackName: "Peer rack", rackPosition: 8, ports: [{ id: 61, portName: "1", portIndex: 1, mediaType: "Copper", status: "Active", portMode: "Trunk", connectedToDeviceId: 2, connectedToPortId: 21 }] };
devices[1].ports = [{ id: 21, portName: "1", portIndex: 1, mediaType: "Copper", status: "Active", portMode: "Trunk", connectedToDeviceId: 6, connectedToPortId: 61 }];
const racks: SceneRack[] = [
    { name: "Demo rack", zone: null, totalU: 42, devices, occupiedU: [], locationName: "Synthetic room", locationId: 1, floorRow: "A", floorSlot: 1, facing: "front", hasMatchingDevices: true, dimmed: false },
    { name: "Peer rack", zone: null, totalU: 42, devices: [peer], occupiedU: [], locationName: "Synthetic room", locationId: 1, floorRow: "B", floorSlot: 1, facing: "front", hasMatchingDevices: true, dimmed: false },
];
const drawer = { loading: false, error: false, data: { picGroups: [], lastAudit: null, incidents: [], siem: { count: 0, latest: [] }, connections: [] } };
export default function RealismFixture() {
    const [selected, setSelected] = useState<RackDevice | null>(devices[1]);
    const [focus, setFocus] = useState<string | null>("Demo rack");
    const [quality, setQuality] = useState<Quality>("medium");
    const [brightness, setBrightness] = useState(1);
    const [fullscreen, setFullscreen] = useState(false);
    const [showFree, setShowFree] = useState(false);
    const [dense, setDense] = useState(false);
    const sceneRacks: SceneRack[] = dense ? Array.from({ length: 8 }, (_, rackIndex) => ({
        ...racks[0], name: `Synthetic dense ${rackIndex + 1}`, floorRow: rackIndex < 4 ? "A" : "B", floorSlot: rackIndex % 4 + 1,
        devices: Array.from({ length: 30 }, (_, index) => ({ ...devices[index % devices.length], id: 100 + rackIndex * 30 + index, name: `Synthetic device ${rackIndex * 30 + index + 1}`, rackName: `Synthetic dense ${rackIndex + 1}`, rackPosition: index + 1, uHeight: 1, ports: [] })),
    })) : racks;
    useEffect(() => {
        const changed = () => setFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", changed);
        return () => document.removeEventListener("fullscreenchange", changed);
    }, []);
    return <main className="p-4">
        <h1 className="mb-3 text-lg font-bold">Synthetic realism fixture — no production data</h1>
        <div className="mb-3 flex flex-wrap gap-4">
            <label>Quality <select aria-label="Fixture quality" value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>{["low", "medium", "high"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Brightness <input aria-label="Fixture brightness" type="range" min={0} max={2} step={0.1} value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
        </div>
        <div aria-label="Fixture scene" className={fullscreen ? "fixed inset-0 z-40" : "relative h-[80vh]"}>
            <div className="absolute left-3 top-3 z-30 flex gap-2">
                <button onClick={() => document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen()}>{fullscreen ? "Exit fullscreen" : "Enter fullscreen"}</button>
                <button onClick={() => setFocus(focus ? null : "Demo rack")}>{focus ? "Whole room" : "Focus demo rack"}</button>
                <button onClick={() => setShowFree(!showFree)}>Toggle free U</button>
                <button onClick={() => { setDense(!dense); setFocus(null); setSelected(null); }}>{dense ? "Small fixture" : "Dense fixture"}</button>
            </div>
            <RackScene racks={sceneRacks} floorPlanUrl={null} qualitySetting={quality} focusRack={focus} onFocusRack={setFocus} showFree={showFree} selectedDeviceId={selected?.id ?? null} peerDeviceId={selected?.id === 2 ? peer.id : null} floatCard={(device) => device.id === peer.id ? <div className="rounded bg-ops-surface p-2 text-ops-text">Synthetic peer card</div> : null} focusDeviceId={null} onSelectDevice={setSelected} temp={null} colorBy="category" appearance={{ ...DEFAULT_APPEARANCE, lightBrightness: brightness }} />
            {selected && <DeviceDetailPanel key={selected.id} docked device={selected} drawerState={drawer} networkState={{ ports: [], loading: false }} onClose={() => setSelected(null)} />}
        </div>
    </main>;
}
