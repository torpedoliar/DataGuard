"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Box, RotateCcw, TriangleAlert } from "lucide-react";
import type { RackDevice } from "@/actions/rack-layout";
import type { SceneRack } from "@/lib/rack-filter";
import { layoutRacks } from "./layout";
import type { QualitySetting } from "./quality";

const RackScene = dynamic(() => import("./rack-scene"), {
    ssr: false,
    loading: () => <div className="grid h-full place-items-center text-sm text-ops-muted">Loading 3D scene…</div>,
});

const QUALITY_KEY = "rack3d-quality";
const UNASSIGNED = "Unassigned Location";
const QUALITIES: QualitySetting[] = ["auto", "high", "medium", "low"];
const selectClass = "h-9 px-3 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text outline-none focus:ring-1 focus:ring-ops-accent";

interface RackView3DProps {
    racks: SceneRack[];
    floorPlans: Record<number, string>;
    selectedDeviceId: number | null;
    autoFocusDeviceId: number | null;
    onSelectDevice: (d: RackDevice | null) => void;
    onWebglUnavailable: () => void;
}

export default function RackView3D({ racks, floorPlans, selectedDeviceId, autoFocusDeviceId, onSelectDevice, onWebglUnavailable }: RackView3DProps) {
    const rooms = useMemo(() => {
        const map = new Map<string, SceneRack[]>();
        for (const r of racks) {
            const key = r.locationName || UNASSIGNED;
            map.set(key, [...(map.get(key) ?? []), r]);
        }
        return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
    }, [racks]);

    const [roomPick, setRoomPick] = useState<string | null>(null);
    const [focusPick, setFocusPick] = useState<string | null>(null);
    const [showFree, setShowFree] = useState(false);
    const [quality, setQuality] = useState<QualitySetting>("auto");

    // A single search hit jumps to its room and rack once; after that the
    // viewer's own room / rack / back choices win.
    const [appliedAuto, setAppliedAuto] = useState<number | null>(null);
    if (autoFocusDeviceId !== appliedAuto) {
        setAppliedAuto(autoFocusDeviceId);
        const hit = autoFocusDeviceId != null ? racks.find((r) => r.devices.some((d) => d.id === autoFocusDeviceId)) : undefined;
        if (hit) {
            setRoomPick(hit.locationName || UNASSIGNED);
            setFocusPick(hit.name);
        }
    }
    const room = roomPick && rooms.has(roomPick) ? roomPick : rooms.keys().next().value ?? null;
    const roomRacks = useMemo(() => (room ? rooms.get(room) ?? [] : []), [room, rooms]);
    const focusRack = roomRacks.some((r) => r.name === focusPick) ? focusPick : null;
    const collisions = useMemo(() => layoutRacks(roomRacks).filter((p) => p.collision).length, [roomRacks]);
    const floorPlanUrl = roomRacks.map((r) => (r.locationId != null ? floorPlans[r.locationId] : undefined)).find(Boolean) ?? null;

    useEffect(() => {
        try {
            const q = localStorage.getItem(QUALITY_KEY) as QualitySetting | null;
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of a per-viewer preference after hydration
            if (q && QUALITIES.includes(q)) setQuality(q);
        } catch { /* storage blocked */ }
    }, []);

    useEffect(() => {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (!gl) onWebglUnavailable();
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
    }, [onWebglUnavailable]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setFocusPick(null);
            onSelectDevice(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onSelectDevice]);

    const pickRoom = (name: string) => {
        setRoomPick(name);
        setFocusPick(null);
        onSelectDevice(null);
    };
    const pickQuality = (q: QualitySetting) => {
        setQuality(q);
        try { localStorage.setItem(QUALITY_KEY, q); } catch { /* storage blocked */ }
    };
    const backToRoom = () => {
        setFocusPick(null);
        onSelectDevice(null);
    };

    if (!room) {
        return (
            <div className="rounded-xl border border-ops-border bg-ops-surface py-16 text-center text-ops-muted">
                <Box className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="text-sm">No racks to show in 3D.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="Room" className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-ops-border bg-ops-surface p-1">
                    {[...rooms.keys()].map((name) => (
                        <button
                            key={name}
                            role="tab"
                            aria-selected={name === room}
                            onClick={() => pickRoom(name)}
                            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                name === room ? "bg-ops-accent/15 text-ops-accent" : "text-ops-muted hover:text-ops-text"
                            }`}
                        >
                            {name}
                        </button>
                    ))}
                </div>
                <select aria-label="Focus rack" value={focusRack ?? ""} onChange={(e) => setFocusPick(e.target.value || null)} className={selectClass}>
                    <option value="">Whole room</option>
                    {roomRacks.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>
                <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-ops-border bg-ops-bg px-3 text-sm text-ops-text">
                    <input type="checkbox" checked={showFree} onChange={(e) => setShowFree(e.target.checked)} className="size-4" />
                    Show free U
                </label>
                <select aria-label="Render quality" value={quality} onChange={(e) => pickQuality(e.target.value as QualitySetting)} className={selectClass}>
                    <option value="auto">Quality: Auto</option>
                    <option value="high">Quality: High</option>
                    <option value="medium">Quality: Medium</option>
                    <option value="low">Quality: Low</option>
                </select>
                {collisions > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-ops-warning">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        {collisions} rack position conflict{collisions > 1 ? "s" : ""}. Check row/slot in Racks.
                    </span>
                )}
            </div>

            <div className="relative h-[70vh] min-h-[480px] overflow-hidden rounded-xl border border-ops-border bg-ops-bg">
                <RackScene
                    racks={roomRacks}
                    floorPlanUrl={floorPlanUrl}
                    qualitySetting={quality}
                    focusRack={focusRack}
                    onFocusRack={setFocusPick}
                    showFree={showFree}
                    selectedDeviceId={selectedDeviceId}
                    focusDeviceId={selectedDeviceId ?? (focusRack ? autoFocusDeviceId : null)}
                    onSelectDevice={onSelectDevice}
                />
                {focusRack && (
                    <button
                        onClick={backToRoom}
                        className="absolute left-3 top-3 flex items-center gap-1.5 rounded-lg border border-ops-border bg-ops-surface/90 px-3 py-1.5 text-sm font-medium text-ops-text shadow backdrop-blur hover:bg-ops-surface"
                    >
                        <RotateCcw className="h-4 w-4" /> Back to room
                    </button>
                )}
                <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-ops-muted">
                    Drag to orbit · Scroll to zoom · Click a rack or device · Esc to go back
                </p>
            </div>
        </div>
    );
}
