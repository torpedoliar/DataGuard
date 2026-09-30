"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Environment, Lightformer, SoftShadows } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { RackDevice } from "@/actions/rack-layout";
import type { SceneRack } from "@/lib/rack-filter";
import { useIsDark } from "@/components/ui/theme-toggle";
import { FRONT_Z, RACK_D, U, rackHeight, uToY } from "./constants";
import { inRack } from "./free-slots";
import { bounds, layoutRacks, type Bounds, type PlacedRack } from "./layout";
import { tickLeds } from "./materials";
import { PRESETS, initialQuality, resolveQuality, type Quality, type QualitySetting } from "./quality";
import { RackCabinet } from "./rack-cabinet";
import { Room } from "./room";

export interface RackSceneProps {
    racks: SceneRack[];
    floorPlanUrl: string | null;
    qualitySetting: QualitySetting;
    focusRack: string | null;
    onFocusRack: (name: string | null) => void;
    showFree: boolean;
    selectedDeviceId: number | null;
    focusDeviceId: number | null;
    onSelectDevice: (d: RackDevice | null) => void;
}

// Mirrors --color-ops-accent in app/globals.css (light / dark).
const ACCENT = { light: "#0d9488", dark: "#5eead4" };

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

function Lighting({ dark, b, preset }: { dark: boolean; b: Bounds; preset: (typeof PRESETS)[Quality] }) {
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2;
    return (
        <>
            <ambientLight intensity={dark ? 0.3 : 0.55} />
            <hemisphereLight args={[dark ? "#3b5b8a" : "#ffffff", dark ? "#05070a" : "#8f98a3", dark ? 0.7 : 1.1]} />
            {/* Aisle fill: soft light down the rows so faceplates read */}
            <directionalLight position={[b.maxX + 6, 2.5, (b.minZ + b.maxZ) / 2]} intensity={dark ? 0.55 : 0.9} color={dark ? "#93c5fd" : "#ffffff"} />
            {/* Lights-out mode: faint blue wash rising from the cold-aisle tiles */}
            {dark && <pointLight position={[(b.minX + b.maxX) / 2, 0.4, (b.minZ + b.maxZ) / 2]} color="#3b82f6" intensity={6} distance={6} decay={1.5} />}
            <directionalLight
                position={[3, 7, 4]}
                intensity={dark ? 0.5 : 1.3}
                castShadow={preset.shadows}
                shadow-mapSize={[2048, 2048]}
                shadow-bias={-0.0004}
                shadow-camera-left={-span}
                shadow-camera-right={span}
                shadow-camera-top={span}
                shadow-camera-bottom={-span}
            />
            {preset.softShadows && <SoftShadows size={18} samples={10} focus={0.6} />}
            <Environment key={dark ? "dark" : "light"} resolution={256} frames={1} environmentIntensity={dark ? 1 : 1.3}>
                {[-3, 0, 3].flatMap((x) => [-3, 0, 3].map((z) => (
                    <Lightformer key={`${x},${z}`} form="rect" intensity={dark ? 0.5 : 2.4} position={[x, 3, z]} rotation-x={Math.PI / 2} scale={[0.8, 1.6, 1]} />
                )))}
                <Lightformer form="rect" intensity={dark ? 0.8 : 0.3} color={dark ? "#3b82f6" : "#ffffff"} position={[0, 1, -8]} scale={[20, 2, 1]} />
            </Environment>
        </>
    );
}

function Effects({ preset, dof }: { preset: (typeof PRESETS)[Quality]; dof: boolean }) {
    if (!preset.bloom) return null; // low: renderer tone mapping, no composer
    return preset.ao ? (
        <EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType}>
            <N8AO aoRadius={0.4} distanceFalloff={0.5} intensity={2} quality="medium" halfRes />
            <Bloom mipmapBlur luminanceThreshold={1} intensity={0.9} />
            <DepthOfField worldFocusDistance={1.6} worldFocusRange={1.4} bokehScale={dof ? 3 : 0} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette offset={0.3} darkness={0.55} />
        </EffectComposer>
    ) : (
        <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
            <Bloom mipmapBlur luminanceThreshold={1} intensity={0.7} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette offset={0.3} darkness={0.5} />
        </EffectComposer>
    );
}

function CameraRig({ placed, b, focusRack, focusDeviceId }: {
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
        const p = hit?.p ?? placed.find((x) => x.rack.name === focusRack);
        if (!p) return home.join(",");
        const dir = p.rotationY === 0 ? 1 : -1;
        if (hit) {
            const y = uToY(hit.d.rackPosition ?? 1) + ((hit.d.uHeight || 1) * U) / 2;
            const fz = p.z + dir * FRONT_Z;
            return [p.x + 0.25, y + 0.2, fz + dir * 1.2, p.x, y, fz].join(",");
        }
        const H = rackHeight(p.rack.totalU || 42);
        return [p.x, H * 0.55, p.z + dir * (RACK_D / 2 + 2.4), p.x, H * 0.45, p.z + dir * (RACK_D / 2)].join(",");
    }, [placed, focusRack, focusDeviceId, home]);

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

export default function RackScene({ racks, floorPlanUrl, qualitySetting, focusRack, onFocusRack, showFree, selectedDeviceId, focusDeviceId, onSelectDevice }: RackSceneProps) {
    const dark = useIsDark();
    const placed = useMemo(() => layoutRacks(racks), [racks]);
    const b = useMemo(() => bounds(placed), [placed]);
    // Auto = GPU heuristic only. No FPS monitor: with frameloop="demand" an
    // idle scene renders ~8 fps (LED blink) and would always read as slow.
    const [autoQuality] = useState<Quality>(() => initialQuality(rendererName(), isMobile()));
    const preset = PRESETS[resolveQuality(qualitySetting, autoQuality)];
    const accent = dark ? ACCENT.dark : ACCENT.light;
    // Other rows stand between the fly-to camera and the focused rack.
    const focusedRow = placed.find((p) => p.rack.name === focusRack)?.row;
    const bg = dark ? "#06080b" : "#dfe3e8";

    return (
        <Canvas
            key={preset.softShadows ? "soft" : "hard"}
            shadows
            dpr={preset.dpr}
            frameloop="demand"
            flat={preset.bloom}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            camera={{ position: [0, 12, 12], fov: 38, near: 0.03, far: 120 }}
            onPointerMissed={() => onSelectDevice(null)}
        >
            <color attach="background" args={[bg]} />
            <fog attach="fog" args={[bg, 14, 45]} />
            <Lighting dark={dark} b={b} preset={preset} />
            <Room placed={placed} b={b} floorPlanUrl={floorPlanUrl} dark={dark} reflections={preset.reflections} />
            {/* Raycasting and <Html> ignore visible=false, so other rows are not
                rendered at all while a rack is focused. */}
            {placed.filter((p) => focusedRow === undefined || p.row === focusedRow).map((p) => (
                <RackCabinet
                    key={p.rack.name}
                    placed={p}
                    dark={dark}
                    focused={focusRack === p.rack.name}
                    faded={p.rack.dimmed || (!!focusRack && focusRack !== p.rack.name)}
                    showFree={showFree}
                    accent={accent}
                    selectedDeviceId={selectedDeviceId}
                    onFocus={() => onFocusRack(p.rack.name)}
                    onSelectDevice={(d) => { onFocusRack(p.rack.name); onSelectDevice(d); }}
                />
            ))}
            <CameraRig placed={placed} b={b} focusRack={focusRack} focusDeviceId={focusDeviceId} />
            <BlinkClock />
            <Effects preset={preset} dof={preset.dof && !!focusRack} />
        </Canvas>
    );
}
