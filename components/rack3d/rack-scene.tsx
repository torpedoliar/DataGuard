"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { CameraControls, Edges, Environment, Lightformer, SoftShadows } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type EffectComposer as ComposerImpl } from "postprocessing";
import type { RackDevice, RoomSettings } from "@/actions/rack-layout";
import { FacilityModel } from "./facility-model";
import { facilityDimensions } from "@/lib/facility-asset";
import type { SceneRack } from "@/lib/rack-filter";
import type { ColorBy } from "@/lib/rack-signals";
import type { RoomAppearance } from "@/lib/room-appearance";
import { useIsDark } from "@/components/ui/theme-toggle";
import { FRONT_Z, RACK_D, ROOM_HEIGHT, U, rackHeight, uToY } from "./constants";
import { inRack } from "./free-slots";
import { AnimatedCables } from "./cables";
import { buildCables } from "./cable-route";
import { bounds, layoutRacks, roomRect, type Bounds, type PlacedRack } from "./layout";
import { tickLeds } from "./materials";
import { PRESETS, initialQuality, resolveQuality, type Quality, type QualitySetting } from "./quality";
import { RackCabinet } from "./rack-cabinet";
import { Room } from "./room";
import { ScreenHtml } from "./screen-html";
import { navigationKey, navigationStep } from "./keyboard-navigation";
import { aisleAngle, type RoomView } from "./room-camera";
import { radialTexture } from "./textures";
import { ceilingLights } from "./ceiling-lights";
import { pointerNdc } from "./pointer-ndc";

export interface RackSceneProps {
    roomView?: RoomView;
    dockCards?: boolean;
    detailPanelOpen?: boolean;
    tracedPortId?: number | null;
    facilities?: RackDevice[];
    openFacilityId?: number | null;
    roomSettings?: RoomSettings;
    racks: SceneRack[];
    floorPlanUrl: string | null;
    qualitySetting: QualitySetting;
    onAutoQuality?: (q: Quality) => void;
    focusRack: string | null;
    onFocusRack: (name: string | null) => void;
    showFree: boolean;
    selectedDeviceId: number | null;
    peerDeviceId?: number | null;
    focusDeviceId: number | null;
    onSelectDevice: (d: RackDevice | null) => void;
    temp: { tempC: number; thresholdC: number | null } | null;
    colorBy: ColorBy;
    appearance: RoomAppearance;
    captureRef?: RefObject<(() => string) | null>;
}

// Mirrors --color-ops-accent in app/globals.css (light / dark).
const ACCENT = { light: "#0e7f6e", dark: "#3cc4a8" };

// R3F's default pointer math reads `offsetX`, which is relative to whatever DOM
// node the event targeted. The hologram card and the tooltip wrappers sit inside
// the same div the events are bound to, so a click on one reports offsets against
// itself and the ray selects a device that is not under the cursor. Measure
// against the canvas rect instead; `clientX` is viewport-absolute.
function pointerFromCanvas(event: { clientX: number; clientY: number }, state: RootState) {
    const rect = state.gl.domElement.getBoundingClientRect();
    const [x, y] = pointerNdc(event.clientX, event.clientY, rect);
    state.pointer.set(x, y);
    state.raycaster.setFromCamera(state.pointer, state.camera);
}

// Probe the GPU on a throwaway context so the first frame already uses the
// right preset (switching SoftShadows after materials compiled breaks their
// shadow samplers).
function rendererName() {
    const ctx = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!ctx) return "";
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
    ctx.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
}

const isMobile = () => window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1024;

// LEDs blink at ~8 fps without running a full-rate render loop; paused while
// the tab is hidden.
function BlinkClock() {
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        const id = setInterval(() => { if (!document.hidden) invalidate(); }, 125);
        return () => clearInterval(id);
    }, [invalidate]);
    useFrame(({ clock }) => tickLeds(clock.elapsedTime));
    return null;
}

function Lighting({ dark, b, quality, appearance, height, taskLight }: {
    dark: boolean; b: Bounds; quality: Quality; appearance: RoomAppearance; height: number;
    taskLight: [number, number, number] | null;
}) {
    const preset = PRESETS[quality];
    const span = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + height;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const target = useMemo(() => {
        const centre = new THREE.Object3D();
        centre.position.set(cx, height * 0.35, cz);
        return centre;
    }, [cx, height, cz]);
    const fixtures = useMemo(() => ceilingLights(b, quality), [b, quality]);
    const k = appearance.lightBrightness;
    const tint = appearance.lightColor;
    const ceiling = tint ?? (dark ? "#c9dff2" : "#fff1d9");
    return (
        <>
            <primitive object={target} />
            <hemisphereLight args={[tint ?? "#e4edf5", dark ? "#263947" : "#65757a", (dark ? 0.49 : 0.68) * k]} />
            <directionalLight target={target} position={[cx - span * 0.48, height + span, cz + span * 0.62]}
                color={tint ?? "#fff1dc"} intensity={(dark ? 0.82 : 1.25) * k}
                castShadow={preset.shadows} shadow-mapSize={quality === "high" ? [2048, 2048] : [1024, 1024]}
                shadow-normalBias={0.007} shadow-bias={-0.0002} shadow-camera-far={span * 4 + height}
                shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} />
            <directionalLight target={target} position={[cx + span, height * 0.85, cz - span * 0.6]}
                color={tint ?? "#b5d8eb"} intensity={0.64 * k} />
            {fixtures.map(([x, z]) => (
                <pointLight key={`${x},${z}`} position={[x, height - 0.12, z]} color={ceiling}
                    intensity={Math.min(26, height * height * 1.45) * k} distance={height * 2.25} decay={2} />
            ))}
            {taskLight && <pointLight position={taskLight} color={tint ?? "#edf5ff"} intensity={3.8 * k} distance={3.2} decay={2} />}
            {preset.softShadows && <SoftShadows size={16} samples={10} focus={0.55} />}
            <Environment key={`${dark}-${tint}`} resolution={quality === "low" ? 128 : 256} frames={1} environmentIntensity={(dark ? 0.78 : 1.04) * k}>
                <Lightformer position={[-2.1, 2.5, 2]} scale={[2.8, 1.2, 1]} color={ceiling} intensity={3.4} />
                <Lightformer position={[2.4, 1, 1]} scale={[0.48, 3.4, 1]} color={tint ?? "#d0e7f4"} intensity={3.8} />
                <Lightformer position={[-2.6, 1, -1.8]} scale={[0.6, 2.8, 1]} color={ceiling} intensity={2.2} />
                <Lightformer position={[0, 3, -1]} scale={[3.8, 0.55, 1]} color={ceiling} intensity={2.5} />
            </Environment>
        </>
    );
}

function Effects({ preset, composerRef }: { preset: (typeof PRESETS)[Quality]; composerRef: RefObject<ComposerImpl | null> }) {
    if (!preset.bloom) return null; // low: renderer tone mapping, no composer
    return preset.ao ? (
        <EffectComposer ref={composerRef} multisampling={4} frameBufferType={THREE.HalfFloatType}>
            <N8AO aoRadius={0.22} distanceFalloff={0.6} intensity={1.35} quality="medium" halfRes />
            <Bloom mipmapBlur luminanceThreshold={1} intensity={0.25} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette offset={0.3} darkness={0.12} />
        </EffectComposer>
    ) : (
        // Medium: no MSAA render targets; SMAA is the cheap edge smoothing.
        <EffectComposer ref={composerRef} multisampling={0} frameBufferType={THREE.HalfFloatType}>
            <Bloom mipmapBlur luminanceThreshold={1} intensity={0.18} />
            <SMAA />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette offset={0.3} darkness={0.1} />
        </EffectComposer>
    );
}

// Screenshot: render once at 2x through the same pipeline (composer when
// effects are on) and read the canvas in the same task, so the drawing
// buffer is still intact without preserveDrawingBuffer.
function Capture({ captureRef, composerRef }: { captureRef: RefObject<(() => string) | null>; composerRef: RefObject<ComposerImpl | null> }) {
    const { gl, scene, camera, size, invalidate } = useThree();
    useEffect(() => {
        captureRef.current = () => {
            const ratio = gl.getPixelRatio();
            const composer = composerRef.current;
            gl.setPixelRatio(Math.min(ratio * 2, 4));
            composer?.setSize(size.width, size.height);
            if (composer) composer.render();
            else gl.render(scene, camera);
            const url = gl.domElement.toDataURL("image/png");
            gl.setPixelRatio(ratio);
            composer?.setSize(size.width, size.height);
            invalidate();
            return url;
        };
        return () => { captureRef.current = null; };
    }, [captureRef, composerRef, gl, scene, camera, size, invalidate]);
    return null;
}

function CameraRig({ placed, b, roomView, focusRack, focusDeviceId, facilities = [] }: {
    roomView: RoomView;
    facilities?: { device: RackDevice; x: number; z: number; dimensions: { height: number; width: number; depth: number } }[];
    placed: PlacedRack<SceneRack>[];
    b: Bounds;
    focusRack: string | null;
    focusDeviceId: number | null;
}) {
    const ref = useRef<CameraControls>(null);
    const keys = useRef(new Set<string>());
    const { gl, invalidate, size } = useThree();
    // Frame the installed equipment, including free-standing assets. Manual
    // rooms can extend many metres beyond the last populated cabinet.
    const extents = useMemo(() => [...placed.map((p) => ({
        x: p.x, z: p.z, radius: RACK_D * 0.58, rotationY: p.rotationY, height: rackHeight(p.rack.totalU || 42),
    })), ...facilities.map((f) => ({
        x: f.x, z: f.z, radius: Math.hypot(f.dimensions.width, f.dimensions.depth) / 2, height: f.dimensions.height,
    }))], [placed, facilities]);
    const minX = extents.length ? Math.min(...extents.map((e) => e.x - e.radius)) : b.minX;
    const maxX = extents.length ? Math.max(...extents.map((e) => e.x + e.radius)) : b.maxX;
    const minZ = extents.length ? Math.min(...extents.map((e) => e.z - e.radius)) : b.minZ;
    const maxZ = extents.length ? Math.max(...extents.map((e) => e.z + e.radius)) : b.maxZ;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const width = maxX - minX, depth = maxZ - minZ;
    const height = Math.max(1, ...extents.map((e) => e.height)) + 0.14;
    const angle = useMemo(() => aisleAngle(extents), [extents]);
    const aspect = size.width / Math.max(1, size.height);
    const home = useMemo((): [number, number, number, number, number, number] => {
        if (roomView === "plan") {
            const x = (b.maxX + b.minX) / 2, z = (b.maxZ + b.minZ) / 2;
            const fit = Math.max((b.maxX - b.minX) / Math.max(0.2, aspect), b.maxZ - b.minZ);
            return [x, height + fit * 1.65, z + 0.001, x, 0, z];
        }
        const sin = Math.sin(angle), cos = Math.cos(angle);
        const across = Math.abs(cos) * width + Math.abs(sin) * depth;
        const along = Math.abs(sin) * width + Math.abs(cos) * depth;
        const pitch = 0.17;
        const fit = Math.max(across / Math.max(0.2, aspect), height + along * pitch);
        const distance = along / 2 + fit * 0.6 / Math.tan(19 * Math.PI / 180);
        return [cx + sin * distance, height / 2 + pitch * distance, cz + cos * distance, cx, height / 2, cz];
    }, [cx, cz, width, depth, height, angle, aspect, roomView, b]);

    // Camera target as a string of plain numbers: a filter keystroke rebuilds
    // `placed` but must not re-trigger the fly-to unless the target moved.
    const target = useMemo(() => {
        const hit = focusDeviceId != null
            ? placed.flatMap((p) => p.rack.devices.map((d) => ({ p, d })))
                .find((x) => x.d.id === focusDeviceId && inRack(x.d, x.p.rack.totalU || 42))
            : undefined;
        const floor = facilities.find((a) => a.device.id === focusDeviceId);
        if (floor) {
            const distance = Math.max(2, floor.dimensions.height * 1.8);
            return [floor.x + distance * 0.5, floor.dimensions.height * 0.8, floor.z + distance, floor.x, floor.dimensions.height / 2, floor.z].join(",");
        }
        const p = hit?.p ?? placed.find((x) => x.rack.name === focusRack);
        if (!p) return home.join(",");
        if (hit) {
            const y = uToY(hit.d.rackPosition ?? 1) + ((hit.d.uHeight || 1) * U) / 2;
            const sin = Math.sin(p.rotationY), cos = Math.cos(p.rotationY);
            const fx = p.x + sin * FRONT_Z, fz = p.z + cos * FRONT_Z;
            return [fx + sin * 1.12 + cos * 0.31, y + 0.2, fz + cos * 1.12 - sin * 0.31, fx + sin * 0.28, y, fz + cos * 0.28].join(",");
        }
        const H = rackHeight(p.rack.totalU || 42);
        const sin = Math.sin(p.rotationY), cos = Math.cos(p.rotationY), distance = RACK_D / 2 + Math.max(2.4, H * 2);
        return [p.x + sin * distance, H * 0.55, p.z + cos * distance, p.x + sin * RACK_D / 2, H * 0.45, p.z + cos * RACK_D / 2].join(",");
    }, [placed, focusRack, focusDeviceId, home, facilities]);

    useEffect(() => {
        const c = ref.current;
        if (!c) return;
        c.smoothTime = 0.28; // fly-to <= 0.8 s
        const [px, py, pz, tx, ty, tz] = target.split(",").map(Number);
        void c.setLookAt(px, py, pz, tx, ty, tz, true);
    }, [target]);

    useEffect(() => {
        const container = gl.domElement.closest<HTMLElement>("[data-rack-keyboard]");
        if (!container) return;
        const clear = () => keys.current.clear();
        const down = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || document.activeElement !== container || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const key = event.key.toLowerCase();
            if (key === "shift") { keys.current.add(key); return; }
            if (!navigationKey(key)) return;
            event.preventDefault();
            if (key === "home") { void ref.current?.setLookAt(...home, true); invalidate(); return; }
            keys.current.add(key); invalidate();
            container.dispatchEvent(new CustomEvent("rack-keyboard-input", { bubbles: true }));
        };
        const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
        container.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", clear);
        container.addEventListener("blur", clear, true);
        document.addEventListener("visibilitychange", clear);
        return () => { clear(); container.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); container.removeEventListener("blur", clear, true); document.removeEventListener("visibilitychange", clear); };
    }, [gl, home, invalidate]);
    useFrame((_, delta) => {
        const controls = ref.current;
        const container = gl.domElement.closest<HTMLElement>("[data-rack-keyboard]");
        if (document.hidden || document.activeElement !== container) { keys.current.clear(); return; }
        if (!controls || keys.current.size === 0) return;
        const step = navigationStep(keys.current, delta);
        if (step.x || step.y) void controls.truck(step.x, step.y, false);
        if (step.z) void controls.forward(step.z, false);
        if (step.yaw || step.pitch) void controls.rotate(step.yaw, step.pitch, false);
        if (step.zoom) void controls.dolly(step.zoom, false);
        invalidate();
    });
    return (
        <CameraControls
            ref={ref}
            makeDefault
            minDistance={0.6}
            maxDistance={Math.max(30, Math.hypot(width, depth) * 4, Math.hypot(home[0] - cx, home[1], home[2] - cz) * 1.2)}
            maxPolarAngle={Math.PI / 2 - 0.05}
            dollyToCursor
        />
    );
}

export default function RackScene({ racks, roomView = "aisle", dockCards = false, detailPanelOpen = false, tracedPortId = null, facilities = [], openFacilityId = null, roomSettings, floorPlanUrl, qualitySetting, onAutoQuality, focusRack, onFocusRack, showFree, selectedDeviceId, peerDeviceId = null, focusDeviceId, onSelectDevice, temp, colorBy, appearance, captureRef, floatCard }: RackSceneProps & { floatCard?: (d: RackDevice) => ReactNode }) {
    const composerRef = useRef<ComposerImpl>(null);
    const dark = useIsDark();
    const manual = roomSettings?.layoutMode === "manual";
    const placed = useMemo(() => layoutRacks(racks).map((p) => manual ? { ...p, x: p.x - (roomSettings?.roomWidthM ?? 0) / 2, z: p.z - (roomSettings?.roomDepthM ?? 0) / 2 } : p), [racks, manual, roomSettings?.roomWidthM, roomSettings?.roomDepthM]);
    const floorAssets = useMemo(() => facilities.filter((d) => d.floorX != null && d.floorZ != null).map((d) => ({ device: d, x: d.floorX! - (manual ? (roomSettings?.roomWidthM ?? 0) / 2 : 0), z: d.floorZ! - (manual ? (roomSettings?.roomDepthM ?? 0) / 2 : 0), dimensions: facilityDimensions({ assetType: d.assetType!, facilitySpecs: d.facilitySpecs ?? null }) })), [facilities, manual, roomSettings?.roomWidthM, roomSettings?.roomDepthM]);
    const b = useMemo(() => {
        if (manual) return { minX: -(roomSettings?.roomWidthM ?? 10) / 2, maxX: (roomSettings?.roomWidthM ?? 10) / 2, minZ: -(roomSettings?.roomDepthM ?? 8) / 2, maxZ: (roomSettings?.roomDepthM ?? 8) / 2 };
        const base = bounds(placed);
        return { minX: Math.min(base.minX, ...floorAssets.map((a) => a.x - Math.max(a.dimensions.width, a.dimensions.depth) / 2)), maxX: Math.max(base.maxX, ...floorAssets.map((a) => a.x + Math.max(a.dimensions.width, a.dimensions.depth) / 2)), minZ: Math.min(base.minZ, ...floorAssets.map((a) => a.z - Math.max(a.dimensions.width, a.dimensions.depth) / 2)), maxZ: Math.max(base.maxZ, ...floorAssets.map((a) => a.z + Math.max(a.dimensions.width, a.dimensions.depth) / 2)) };
    }, [placed, floorAssets, manual, roomSettings?.roomWidthM, roomSettings?.roomDepthM]);
    // Auto = GPU heuristic only. No FPS monitor: with frameloop="demand" an
    // idle scene renders ~8 fps (LED blink) and would always read as slow.
    const [autoQuality] = useState<Quality>(() => initialQuality(rendererName(), isMobile()));
    useEffect(() => onAutoQuality?.(autoQuality), [autoQuality, onAutoQuality]);
    const quality = resolveQuality(qualitySetting, autoQuality);
    const preset = PRESETS[quality];
    const accent = dark ? ACCENT.dark : ACCENT.light;
    // Other rows stand between the fly-to camera and the focused rack.
    // Both watched devices keep their rows and their peer racks in the scene: a
    // same-room peer in another rack would otherwise be dropped while a rack is
    // focused, and the peer hologram would have no device to sit on.
    const { peerRacks } = useMemo(
        () => buildCables(placed, [selectedDeviceId, peerDeviceId], selectedDeviceId),
        [placed, selectedDeviceId, peerDeviceId],
    );
    const bg = dark ? "#0b0f15" : "#8899a4";

    const planView = roomView === "plan" && !focusRack && focusDeviceId == null;
    const roomBounds = useMemo(() => {
        if (manual) return b;
        const rect = roomRect(b);
        return { minX: rect.x0, maxX: rect.x1, minZ: rect.z0, maxZ: rect.z1 };
    }, [manual, b]);
    const cameraBounds = roomView === "plan" ? roomBounds : b;
    const taskLight = useMemo((): [number, number, number] | null => {
        const id = selectedDeviceId ?? focusDeviceId;
        const asset = floorAssets.find((a) => a.device.id === id);
        const rack = placed.find((p) => p.rack.name === focusRack);
        if (!asset && !rack) return null;
        const device = rack?.rack.devices.find((d) => d.id === id);
        const faceY = asset ? asset.dimensions.height * 0.55 : device
            ? uToY(device.rackPosition ?? 1) + (device.uHeight || 1) * U / 2
            : rackHeight(rack!.rack.totalU || 42) / 2;
        const angle = asset ? (asset.device.floorRotation ?? 0) * Math.PI / 180 : rack!.rotationY;
        const distance = (asset?.dimensions.depth ?? RACK_D) / 2 + 0.92;
        const x = asset?.x ?? rack!.x, z = asset?.z ?? rack!.z;
        return [x + Math.sin(angle) * distance - Math.cos(angle) * 0.45, faceY + 0.48,
            z + Math.cos(angle) * distance + Math.sin(angle) * 0.45];
    }, [selectedDeviceId, focusDeviceId, floorAssets, placed, focusRack]);
    const roomSpan = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
    const docked = dockCards && floatCard && !detailPanelOpen ? [selectedDeviceId, peerDeviceId].flatMap((id) => {
        if (id == null) return [];
        for (const { rack } of placed) {
            const hit = rack.devices.find((d) => d.id === id && inRack(d, rack.totalU || 42));
            if (hit) return [hit];
        }
        return [];
    }) : [];
    return (
        <div className="@container h-full w-full">
            <div className="flex h-full flex-col @[700px]:flex-row">
                <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                    <Canvas
                        style={{ zIndex: 0 }}
                        key={quality}
                        shadows={preset.shadows}
                        dpr={preset.dpr}
                        frameloop="demand"
                        flat={preset.bloom}
                        gl={{ antialias: !preset.bloom, powerPreference: "high-performance" }}
                        camera={{ position: [0, 12, 12], fov: 38, near: 0.03, far: Math.max(120, roomSpan * 15) }}
                        onCreated={(state) => state.setEvents({ compute: pointerFromCanvas })}
                        onPointerMissed={() => onSelectDevice(null)}
                    >
                        <color attach="background" args={[bg]} />
                        <fog attach="fog" args={[bg, planView ? roomSpan * 12 : 14, planView ? roomSpan * 15 + 45 : Math.max(45, roomSpan * 2)]} />
                        <Lighting dark={dark} b={roomBounds} quality={quality} appearance={appearance} height={roomSettings?.roomHeightM ?? ROOM_HEIGHT} taskLight={taskLight} />
                        <Room cutaway={planView} placed={placed} b={b} floorPlanUrl={floorPlanUrl} dark={dark} reflections={preset.reflections} temp={temp} appearance={appearance} exactBounds={manual} roomHeight={roomSettings?.roomHeightM ?? undefined} />
                        {/* Focus changes camera and fade, never room inventory/placement. */}
                        {placed.map((p) => (
                            <RackCabinet
                                key={p.rack.name}
                                planView={planView}
                                tracedPortId={tracedPortId}
                                placed={p}
                                dark={dark}
                                focused={focusRack === p.rack.name}
                                detailed={quality === "high"}
                                faded={p.rack.dimmed || (!!focusRack && focusRack !== p.rack.name && !peerRacks.has(p.rack.name))}
                                showFree={showFree}
                                accent={accent}
                                colorBy={colorBy}
                                selectedDeviceId={selectedDeviceId}
                                peerDeviceId={peerDeviceId}
                                onFocus={() => onFocusRack(p.rack.name)}
                                onSelectDevice={(d) => { onFocusRack(p.rack.name); onSelectDevice(d); }}
                                floatCard={dockCards ? undefined : floatCard}
                            />
                        ))}
                        {floorAssets.map(({ device, x, z, dimensions }) => <group key={device.id} position={[x, dimensions.height / 2 + 0.004, z]} rotation-y={(device.floorRotation ?? 0) * Math.PI / 180} onClick={(event) => { event.stopPropagation(); onFocusRack(null); onSelectDevice(device); }}>
                            <mesh rotation-x={-Math.PI / 2} position={[0, -dimensions.height / 2 + 0.002, 0]} raycast={() => null}>
                                <planeGeometry args={[dimensions.width * 1.55, dimensions.depth * 1.55]} />
                                <meshBasicMaterial alphaMap={radialTexture()} color="#18222b" transparent opacity={0.55} depthWrite={false} />
                            </mesh>
                            <FacilityModel device={device} cabinetOpen={openFacilityId === device.id} animateFans opacity={(device as RackDevice & { isMuted?: boolean }).isMuted ? 0.18 : 1} detailed={quality === "high" || selectedDeviceId === device.id} />
                            <mesh position={[0, -dimensions.height / 2 + 0.045, dimensions.depth / 2 + 0.004]}><boxGeometry args={[dimensions.width * 0.65, 0.025, 0.006]} /><meshBasicMaterial color={colorBy === "audit" ? device.status === "NOT OK" ? "#dc2626" : device.status === "OK" ? "#16a34a" : "#64748b" : device.categoryColor ?? "#64748b"} /></mesh>
                            {selectedDeviceId === device.id && <mesh><boxGeometry args={[dimensions.width + 0.025, dimensions.height + 0.025, dimensions.depth + 0.025]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /><Edges color={accent} /></mesh>}
                        </group>)}
                        {floatCard && floorAssets.filter(({ device }) => device.id === selectedDeviceId || device.id === peerDeviceId).map(({ device, x, z, dimensions }) => <ScreenHtml key={`facility-card-${device.id}`} position={[x + dimensions.width / 2 + 0.9, dimensions.height * 0.8, z + dimensions.depth / 2]} center zIndexRange={[40, 0]}>{floatCard(device)}</ScreenHtml>)}
                        <AnimatedCables tracedPortId={tracedPortId} placed={placed} selectedDeviceId={selectedDeviceId} peerDeviceId={peerDeviceId} />
                        <CameraRig roomView={roomView} facilities={floorAssets} placed={placed} b={cameraBounds} focusRack={focusRack} focusDeviceId={focusDeviceId} />
                        <BlinkClock />
                        <Effects preset={preset} composerRef={composerRef} />
                        {captureRef && <Capture captureRef={captureRef} composerRef={composerRef} />}
                    </Canvas>
                </div>
                {docked.length > 0 && (
                    <aside aria-label="Rack inspection" className="z-10 flex max-h-[38%] shrink-0 flex-col items-center gap-3 overflow-auto border-ops-border bg-ops-bg p-2 @[700px]:max-h-none @[700px]:w-[19rem] @[700px]:border-l @[700px]:pt-16">
                        {docked.map((d) => (
                            <div key={d.id}>
                                {d.id === peerDeviceId && <button className="mb-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-accent hover:underline" onClick={() => { onFocusRack(d.rackName); onSelectDevice(d); }}>Inspect {d.name} →</button>}
                                {floatCard?.(d)}
                            </div>
                        ))}
                    </aside>
                )}
            </div>
        </div>
    );
}
