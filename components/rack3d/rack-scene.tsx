"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { CameraControls, Environment, Lightformer, SoftShadows } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type EffectComposer as ComposerImpl } from "postprocessing";
import type { RackDevice, RoomSettings } from "@/actions/rack-layout";
import { FacilityModel } from "./facility-model";
import { facilityDimensions } from "@/lib/facility-asset";
import type { SceneRack } from "@/lib/rack-filter";
import type { ColorBy } from "@/lib/rack-signals";
import type { RoomAppearance } from "@/lib/room-appearance";
import { useIsDark } from "@/components/ui/theme-toggle";
import { FRONT_Z, RACK_D, U, rackHeight, uToY } from "./constants";
import { inRack } from "./free-slots";
import { AnimatedCables } from "./cables";
import { buildCables } from "./cable-route";
import { bounds, layoutRacks, type Bounds, type PlacedRack } from "./layout";
import { tickLeds } from "./materials";
import { PRESETS, initialQuality, resolveQuality, type Quality, type QualitySetting } from "./quality";
import { RackCabinet } from "./rack-cabinet";
import { Room } from "./room";
import { pointerNdc } from "./pointer-ndc";

export interface RackSceneProps {
    facilities?: RackDevice[];
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
const ACCENT = { light: "#0d9488", dark: "#5eead4" };

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

// Ceiling light fixtures over the racks (dark mode): a few lights spread
// over the room so faceplates read like a real DC with the lights on low.
// ponytail: capped at 6 unshadowed point lights; a bigger room gets the same 6
// spread wider, switch to baked lighting if rooms grow past ~40 racks.
function ceilingSpots(b: Bounds): [number, number][] {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const nx = Math.min(3, Math.max(1, Math.round(w / 3)));
    const nz = Math.min(2, Math.max(1, Math.round(d / 2.5)));
    const out: [number, number][] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        out.push([b.minX + (w * (i + 0.5)) / nx, b.minZ + (d * (j + 0.5)) / nz]);
    }
    return out;
}

function Lighting({ dark, b, preset, appearance }: { dark: boolean; b: Bounds; preset: (typeof PRESETS)[Quality]; appearance: RoomAppearance }) {
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2;
    const spots = useMemo(() => ceilingSpots(b), [b]);
    // Room tint + brightness (per location) on top of the theme's base light.
    const k = appearance.lightBrightness;
    const tint = appearance.lightColor;
    return (
        <>
            <ambientLight intensity={0.75 * k} />
            <hemisphereLight args={[tint ?? ("#f4f6f8"), "#77818a", 1.4 * k]} />
            {/* Aisle fill: soft light down the rows so faceplates read */}
            <directionalLight position={[b.maxX + 6, 2.5, (b.minZ + b.maxZ) / 2]} intensity={0.9 * k} color={tint ?? "#ffffff"} />
            <directionalLight position={[b.minX - 6, 2.2, (b.minZ + b.maxZ) / 2]} intensity={0.45 * k} color={tint ?? "#ffffff"} />
            {dark && spots.map(([x, z]) => (
                <pointLight key={`${x},${z}`} position={[x, 2.9, z]} intensity={7 * k} distance={8} decay={1.2} color={tint ?? "#e6eefc"} />
            ))}
            <directionalLight
                position={[3, 7, 4]}
                intensity={1.3 * k}
                castShadow={preset.shadows}
                shadow-mapSize={[2048, 2048]}
                shadow-bias={-0.0004}
                shadow-camera-left={-span}
                shadow-camera-right={span}
                shadow-camera-top={span}
                shadow-camera-bottom={-span}
            />
            {preset.softShadows && <SoftShadows size={18} samples={10} focus={0.6} />}
            <Environment key={dark ? "dark" : "light"} resolution={256} frames={1} environmentIntensity={1.1 * k}>
                {[-3, 0, 3].flatMap((x) => [-3, 0, 3].map((z) => (
                    <Lightformer key={`${x},${z}`} form="rect" intensity={dark ? 1.4 : 2.4} position={[x, 3, z]} rotation-x={Math.PI / 2} scale={[0.8, 1.6, 1]} />
                )))}
                <Lightformer form="rect" intensity={dark ? 0.8 : 0.3} color="#ffffff" position={[0, 1, -8]} scale={[20, 2, 1]} />
            </Environment>
        </>
    );
}

function Effects({ preset, composerRef }: { preset: (typeof PRESETS)[Quality]; composerRef: RefObject<ComposerImpl | null> }) {
    if (!preset.bloom) return null; // low: renderer tone mapping, no composer
    return preset.ao ? (
        <EffectComposer ref={composerRef} multisampling={4} frameBufferType={THREE.HalfFloatType}>
            <N8AO aoRadius={0.4} distanceFalloff={0.5} intensity={2} quality="medium" halfRes />
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

function CameraRig({ placed, b, focusRack, focusDeviceId, facilities = [] }: {
    facilities?: { device: RackDevice; x: number; z: number; dimensions: { height: number; width: number; depth: number } }[];
    placed: PlacedRack<SceneRack>[];
    b: Bounds;
    focusRack: string | null;
    focusDeviceId: number | null;
}) {
    const ref = useRef<CameraControls>(null);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 2);
    // Rows facing each other form a cold aisle: look down it at eye height.
    // A single forward row gets a raised front three-quarter view.
    const aisle = placed.some((p) => p.rotationY !== 0) && placed.some((p) => p.rotationY === 0);
    const home = useMemo(() => {
        if (aisle) return [b.maxX + 4.2, 2.3, cz + 1.6, b.minX + 0.3, 0.9, cz] as [number, number, number, number, number, number];
        const d = Math.max(4.5, span * 1.3);
        return [cx + d * 0.45, d * 0.5, cz + d, cx, 0.9, cz] as [number, number, number, number, number, number];
    }, [aisle, b.maxX, b.minX, cx, cz, span]);

    // Intro: drop in from above (<=1.5 s); any drag interrupts it.
    useEffect(() => {
        const c = ref.current;
        if (!c) return;
        c.setLookAt(cx, span * 2 + 6, cz + 0.01, cx, 0, cz, false);
        c.smoothTime = 0.45;
        void c.setLookAt(...home, true);
    }, [home, cx, cz, span]);

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
            return [fx + sin * 1.2 + cos * 0.25, y + 0.2, fz + cos * 1.2 - sin * 0.25, fx, y, fz].join(",");
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

    return (
        <CameraControls
            ref={ref}
            makeDefault
            minDistance={0.6}
            maxDistance={30}
            maxPolarAngle={Math.PI / 2 - 0.05}
            dollyToCursor
        />
    );
}

export default function RackScene({ racks, facilities = [], roomSettings, floorPlanUrl, qualitySetting, onAutoQuality, focusRack, onFocusRack, showFree, selectedDeviceId, peerDeviceId = null, focusDeviceId, onSelectDevice, temp, colorBy, appearance, captureRef, floatCard }: RackSceneProps & { floatCard?: (d: RackDevice) => ReactNode }) {
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
    const focusedRow = placed.find((p) => p.rack.name === focusRack)?.row;
    // Both watched devices keep their rows and their peer racks in the scene: a
    // same-room peer in another rack would otherwise be dropped while a rack is
    // focused, and the peer hologram would have no device to sit on.
    const { peerRacks } = useMemo(
        () => buildCables(placed, [selectedDeviceId, peerDeviceId], selectedDeviceId),
        [placed, selectedDeviceId, peerDeviceId],
    );
    const bg = dark ? "#0b0f15" : "#dfe3e8";

    return (
        <Canvas
            style={{ zIndex: 0 }}
            key={quality}
            shadows={preset.shadows}
            dpr={preset.dpr}
            frameloop="demand"
            flat={preset.bloom}
            gl={{ antialias: !preset.bloom, powerPreference: "high-performance" }}
            camera={{ position: [0, 12, 12], fov: 38, near: 0.03, far: 120 }}
            onCreated={(state) => state.setEvents({ compute: pointerFromCanvas })}
            onPointerMissed={() => onSelectDevice(null)}
        >
            <color attach="background" args={[bg]} />
            <fog attach="fog" args={[bg, 14, 45]} />
            <Lighting dark={dark} b={b} preset={preset} appearance={appearance} />
            <Room placed={placed} b={b} floorPlanUrl={floorPlanUrl} dark={dark} reflections={preset.reflections} temp={temp} appearance={appearance} exactBounds={manual} roomHeight={roomSettings?.roomHeightM ?? undefined} />
            {/* Raycasting and <Html> ignore visible=false, so other rows are not
                rendered at all while a rack is focused. */}
            {placed.filter((p) => focusedRow === undefined || p.row === focusedRow || peerRacks.has(p.rack.name)).map((p) => (
                <RackCabinet
                    key={p.rack.name}
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
                    floatCard={floatCard}
                />
            ))}
            {floorAssets.map(({ device, x, z, dimensions }) => <group key={device.id} position={[x, dimensions.height / 2, z]} rotation-y={(device.floorRotation ?? 0) * Math.PI / 180} onClick={(event) => { event.stopPropagation(); onFocusRack(null); onSelectDevice(device); }}>
                <FacilityModel device={device} opacity={(device as RackDevice & { isMuted?: boolean }).isMuted ? 0.18 : 1} detailed={quality === "high" || selectedDeviceId === device.id} />
                <mesh position={[0, -dimensions.height / 2 + 0.045, dimensions.depth / 2 + 0.004]}><boxGeometry args={[dimensions.width * 0.65, 0.025, 0.006]} /><meshBasicMaterial color={colorBy === "audit" ? device.status === "NOT OK" ? "#dc2626" : device.status === "OK" ? "#16a34a" : "#64748b" : device.categoryColor ?? "#64748b"} /></mesh>
                {selectedDeviceId === device.id && <mesh><boxGeometry args={[dimensions.width + 0.025, dimensions.height + 0.025, dimensions.depth + 0.025]} /><meshBasicMaterial color={accent} wireframe /></mesh>}
            </group>)}
            <AnimatedCables placed={placed} selectedDeviceId={selectedDeviceId} peerDeviceId={peerDeviceId} />
            <CameraRig facilities={floorAssets} placed={placed} b={b} focusRack={focusRack} focusDeviceId={focusDeviceId} />
            <BlinkClock />
            <Effects preset={preset} composerRef={composerRef} />
            {captureRef && <Capture captureRef={captureRef} composerRef={composerRef} />}
        </Canvas>
    );
}
