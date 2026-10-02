"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Camera, Maximize, Minimize, Palette, Pause, Play, RotateCcw, TriangleAlert } from "lucide-react";
import type { RackDevice, RoomSettings } from "@/actions/rack-layout";
import type { SceneRack } from "@/lib/rack-filter";
import { rackSummary, tourOrder, troubledCritical, type ColorBy } from "@/lib/rack-signals";
import { DEFAULT_APPEARANCE, type RoomAppearance } from "@/lib/room-appearance";
import { AppearancePanel } from "./appearance-panel";
import { CriticalAlert } from "./critical-alert";
import { DeviceCardPanel, type CardPort } from "./device-card-panel";
import { getPortsByDevice } from "@/actions/network";
import { layoutRacks } from "./layout";
import { QUALITY_LABELS, QUALITY_SETTINGS, parseQualitySetting, type Quality, type QualitySetting } from "./quality";
import { downloadWithFooter, screenshotFooter, screenshotName } from "./screenshot";

const RackScene = dynamic(() => import("./rack-scene"), {
    ssr: false,
    loading: () => <div className="grid h-full place-items-center text-sm text-ops-muted">Loading 3D scene…</div>,
});

const QUALITY_KEY = "rack3d-quality";
const TOUR_MS = 5000;
const UNASSIGNED = "Unassigned Location";
const selectClass = "h-9 px-3 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text outline-none focus:ring-1 focus:ring-ops-accent";
const overlayButton = "flex items-center gap-1.5 rounded-lg border border-ops-border bg-ops-surface/90 px-3 py-1.5 text-sm font-medium text-ops-text shadow backdrop-blur hover:bg-ops-surface";

interface RackView3DProps {
    racks: SceneRack[];
    locationFilter?: string | null;
    rooms: Record<number, RoomSettings>;
    selectedDeviceId: number | null;
    autoFocusDeviceId: number | null;
    onSelectDevice: (d: RackDevice | null) => void;
    onWebglUnavailable: () => void;
    canEditAppearance: boolean;
    siteName: string;
}

export default function RackView3D({ racks, locationFilter = null, rooms: roomSettings, selectedDeviceId, autoFocusDeviceId, onSelectDevice, onWebglUnavailable, canEditAppearance, siteName }: RackView3DProps) {
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
    const [colorBy, setColorBy] = useState<ColorBy>("category");
    const [quality, setQuality] = useState<QualitySetting>("auto");
    // What Auto resolved to on this GPU, reported back by the scene.
    const [autoResolved, setAutoResolved] = useState<Quality | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);
    const router = useRouter();
    // Appearance editor: open for one location; preview overrides the saved
    // look only while that room's editor is open.
    const [editing, setEditing] = useState<number | null>(null);
    const [preview, setPreview] = useState<RoomAppearance | null>(null);
    const [saved, setSaved] = useState<Record<number, RoomAppearance>>({});
    const [touring, setTouring] = useState(false);
    const captureRef = useRef<(() => string) | null>(null);
    // Ports for the docked card panel (network docs): fetched when the
    // selection changes, stale responses discarded by id match.
    const [cardPorts, setCardPorts] = useState<CardPort[]>([]);
    const [cardLoading, setCardLoading] = useState(false);

    // Picking a location in the filter bar opens that room.
    const [appliedLocation, setAppliedLocation] = useState<string | null>(null);
    if (locationFilter !== appliedLocation) {
        setAppliedLocation(locationFilter);
        if (locationFilter && rooms.has(locationFilter)) {
            setRoomPick(locationFilter);
            setFocusPick(null);
        }
    }

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
    // Selecting a device from anywhere (drawer connection, critical popup)
    // opens its room and rack so the fly-to target is rendered.
    const [appliedSelected, setAppliedSelected] = useState<number | null>(null);
    if (selectedDeviceId !== appliedSelected) {
        setAppliedSelected(selectedDeviceId);
        const hit = selectedDeviceId != null ? racks.find((r) => r.devices.some((d) => d.id === selectedDeviceId)) : undefined;
        if (hit) {
            setRoomPick(hit.locationName || UNASSIGNED);
            setFocusPick(hit.name);
        }
    }
    const room = roomPick && rooms.has(roomPick) ? roomPick : rooms.keys().next().value ?? null;
    const roomRacks = useMemo(() => (room ? rooms.get(room) ?? [] : []), [room, rooms]);
    const focusRack = roomRacks.some((r) => r.name === focusPick) ? focusPick : null;
    const cardDevice = selectedDeviceId == null ? null : racks.flatMap((r) => r.devices).find((d) => d.id === selectedDeviceId) ?? null;
    const cardDeviceId = cardDevice?.id ?? null;
    useEffect(() => {
        if (cardDeviceId == null) return;
        let alive = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch result for the selected device, guarded by alive + id match
        setCardLoading(true);
        getPortsByDevice(cardDeviceId)
            .then((ports) => { if (alive) { setCardPorts(ports); setCardLoading(false); } })
            .catch(() => { if (alive) { setCardPorts([]); setCardLoading(false); } });
        return () => { alive = false; };
    }, [cardDeviceId]);
    const order = useMemo(() => tourOrder(roomRacks), [roomRacks]);
    useEffect(() => {
        if (!touring || order.length === 0) return;
        const id = setInterval(() => setFocusPick((cur) => order[(order.indexOf(cur ?? "") + 1) % order.length]), TOUR_MS);
        return () => clearInterval(id);
    }, [touring, order]);
    const collisions = useMemo(() => layoutRacks(roomRacks).filter((p) => p.collision).length, [roomRacks]);
    const locationId = roomRacks.find((r) => r.locationId != null)?.locationId ?? null;
    const settings = locationId != null ? roomSettings[locationId] : undefined;
    const floorPlanUrl = settings?.floorPlanPath ?? null;
    const temp = settings?.tempC != null ? { tempC: settings.tempC, thresholdC: settings.tempThresholdC } : null;
    const editingHere = editing != null && editing === locationId;
    const appearance = (editingHere ? preview : null) ?? (locationId != null ? saved[locationId] : undefined) ?? settings?.appearance ?? DEFAULT_APPEARANCE;
    const openEditor = () => { setPreview(null); setEditing(locationId); };
    const closeEditor = () => { setEditing(null); setPreview(null); };
    const onSaved = (a: RoomAppearance) => {
        if (locationId != null) setSaved((s) => ({ ...s, [locationId]: a }));
        closeEditor();
        router.refresh();
    };
    const troubled = useMemo(() => troubledCritical(roomRacks), [roomRacks]);

    // Critical popup: once per room per browser session; the chip reopens it.
    useEffect(() => {
        if (!room || troubled.length === 0) return;
        const key = `rack3d-critical:${room}`;
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, "1");
        } catch { /* storage blocked: show it every time */ }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot per room per session, gated by sessionStorage
        setAlertOpen(true);
    }, [room, troubled.length]);

    useEffect(() => {
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of a per-viewer preference after hydration
            setQuality(parseQualitySetting(localStorage.getItem(QUALITY_KEY)));
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
            setTouring(false);
            setFocusPick(null);
            onSelectDevice(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onSelectDevice]);

    const pickRoom = (name: string) => {
        setTouring(false);
        setRoomPick(name);
        setFocusPick(null);
        onSelectDevice(null);
    };
    const pickQuality = (q: QualitySetting) => {
        setQuality(q);
        try { localStorage.setItem(QUALITY_KEY, q); } catch { /* storage blocked */ }
    };
    const backToRoom = () => {
        setTouring(false);
        setFocusPick(null);
        onSelectDevice(null);
    };
    const startTour = () => {
        if (order.length === 0) return;
        onSelectDevice(null);
        setFocusPick(order[0]);
        setTouring(true);
    };
    // Any drag, click or wheel in the scene hands control back to the user
    // (buttons marked data-keep-tour excepted).
    const stopTourOnInput = (e: { target: EventTarget }) => {
        if (touring && !(e.target as HTMLElement).closest("[data-keep-tour]")) setTouring(false);
    };
    const screenshot = () => {
        const url = captureRef.current?.();
        if (!url || !room) return;
        const at = new Date();
        void downloadWithFooter(url, screenshotFooter(room, siteName, at), screenshotName(room, at));
    };
    // Fullscreen the whole page and pin the scene over it, so the drawer and
    // dialogs (portalled to <body>) stay visible.
    const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => { /* Fullscreen API blocked */ });
    };

    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    const pickCritical = (device: RackDevice) => {
        setAlertOpen(false);
        onSelectDevice(device);
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
                <label className="flex items-center gap-2 text-sm text-ops-muted">
                    Color by
                    <select aria-label="Color by" value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} className={selectClass}>
                        <option value="category">Category</option>
                        <option value="occupancy">Occupancy</option>
                        <option value="audit">Audit status</option>
                    </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-ops-muted">
                    Quality
                    <select
                        aria-label="Render quality"
                        value={quality}
                        onChange={(e) => pickQuality(parseQualitySetting(e.target.value))}
                        title="Lower this if the 3D view feels slow. Saved in this browser."
                        className={selectClass}
                    >
                        {QUALITY_SETTINGS.map((q) => (
                            <option key={q} value={q}>
                                {q === "auto" && autoResolved ? `Auto (${autoResolved[0].toUpperCase()}${autoResolved.slice(1)})` : QUALITY_LABELS[q]}
                            </option>
                        ))}
                    </select>
                </label>
                {collisions > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-ops-warning">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        {collisions} rack position conflict{collisions > 1 ? "s" : ""}. Check row/slot in Racks.
                    </span>
                )}
            </div>

            <div className={`overflow-hidden border-ops-border bg-ops-bg ${isFullscreen ? "fixed inset-0 z-40" : "relative h-[70vh] min-h-[480px] rounded-xl border"}`} aria-label="3D rack scene" onPointerDownCapture={stopTourOnInput} onWheelCapture={stopTourOnInput}>
                <div className="absolute right-3 top-3 z-10 flex gap-2" data-keep-tour>
                    <button onClick={touring ? () => setTouring(false) : startTour} aria-pressed={touring} title="Fly through every rack" className={overlayButton}>
                        {touring ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {touring ? "Stop tour" : "Tour"}
                    </button>
                    <button onClick={screenshot} aria-label="Download screenshot" title="Download a PNG of this view" className={overlayButton}>
                        <Camera className="h-4 w-4" />
                    </button>
                    {canEditAppearance && locationId != null && (
                        <button onClick={openEditor} aria-label="Room appearance" title="Light colour and wallpaper" className={overlayButton}>
                            <Palette className="h-4 w-4" /> Appearance
                        </button>
                    )}
                    <button onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"} className={overlayButton}>
                        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                        {isFullscreen ? "Exit" : "Fullscreen"}
                    </button>
                </div>
                {editingHere && locationId != null && (
                    <AppearancePanel locationId={locationId} value={appearance} onPreview={setPreview} onSaved={onSaved} onClose={closeEditor} />
                )}
                <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                <RackScene
                    racks={roomRacks}
                    floorPlanUrl={floorPlanUrl}
                    qualitySetting={quality}
                    onAutoQuality={setAutoResolved}
                    focusRack={focusRack}
                    onFocusRack={setFocusPick}
                    showFree={showFree}
                    selectedDeviceId={selectedDeviceId}
                    focusDeviceId={selectedDeviceId ?? (focusRack ? autoFocusDeviceId : null)}
                    onSelectDevice={onSelectDevice}
                    temp={temp}
                    colorBy={colorBy}
                    appearance={appearance}
                    captureRef={captureRef}
                />
                </div>
                {cardDevice && (
                    <DeviceCardPanel
                        device={cardDevice}
                        ports={cardPorts}
                        loading={cardLoading}
                        onClose={() => onSelectDevice(null)}
                        onSelectPeer={(peerId) => {
                            const hit = racks.find((r) => r.devices.some((d) => d.id === peerId));
                            if (hit) {
                                setRoomPick(hit.locationName || UNASSIGNED);
                                setFocusPick(hit.name);
                                const found = hit.devices.find((d) => d.id === peerId);
                                if (found) onSelectDevice(found);
                            }
                        }}
                    />
                )}
                </div>
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
                {touring && focusRack && (() => {
                    const rack = roomRacks.find((r) => r.name === focusRack);
                    if (!rack) return null;
                    const s = rackSummary(rack);
                    return (
                        <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-ops-border bg-ops-surface/90 px-4 py-2 text-center shadow backdrop-blur">
                            <p className="text-base font-bold text-ops-text">{rack.name}</p>
                            <p className="text-xs text-ops-muted">
                                {s.devices} devices · <span className="text-ops-success">{s.ok} OK</span> · <span className="text-ops-danger">{s.notOk} NOT OK</span> · {s.pending} pending · {s.incidents} open incidents
                            </p>
                        </div>
                    );
                })()}
                {troubled.length > 0 && !alertOpen && (
                    <button
                        onClick={() => setAlertOpen(true)}
                        className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-lg bg-ops-danger px-3 py-1.5 text-sm font-semibold text-white shadow hover:opacity-90"
                    >
                        <TriangleAlert className="h-4 w-4" /> {troubled.length} critical
                    </button>
                )}
            </div>
            <CriticalAlert open={alertOpen} items={troubled} onClose={() => setAlertOpen(false)} onPick={pickCritical} />
        </div>
    );
}
