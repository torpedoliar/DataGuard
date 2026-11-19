"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Detailed, RoundedBox } from "@react-three/drei";
import { ScreenHtml as Html } from "./screen-html";
import type { FilteredDevice, SceneRack } from "@/lib/rack-filter";
import { criticalProblem, OCCUPANCY_COLOR, occupancyBand, type ColorBy } from "@/lib/rack-signals";
import { FACE_W, FRONT_Z, PLINTH, RACK_D, RACK_W, U, rackHeight, uToY } from "./constants";
import { freeRanges, inRack, type FreeRange } from "./free-slots";
import type { PlacedRack } from "./layout";
import { sharedMaterials } from "./materials";
import { RackDevice } from "./rack-device";
import { HousingGrille } from "./housing-grille";
import { hardwareTexture, radialTexture, perforationTexture, railTexture, repeated } from "./textures";
import { useLabelTexture } from "./use-label-texture";
import { useFade } from "./use-fade";

// Front door hinged on the left, perforated steel; swings open on focus.
function Door({ height, open }: { height: number; open: boolean }) {
    const hinge = useRef<THREE.Group>(null);
    const invalidate = useThree((s) => s.invalidate);
    const alpha = useMemo(() => repeated(perforationTexture(), RACK_W / 0.096, height / 0.096), [height]);

    useEffect(() => () => alpha.dispose(), [alpha]);

    useFrame((_, dt) => {
        const g = hinge.current;
        if (!g) return;
        const target = open ? -1.9 : 0;
        g.rotation.y = THREE.MathUtils.damp(g.rotation.y, target, 6, dt);
        if (Math.abs(g.rotation.y - target) > 0.001) invalidate();
    });

    return (
        <group ref={hinge} position={[-RACK_W / 2, PLINTH + 0.01 + height / 2, RACK_D / 2 + 0.006]}>
            <Detailed distances={[0, 2.8]} hysteresis={0.1} position={[RACK_W / 2, 0, 0]}>
                <mesh>
                    <planeGeometry args={[RACK_W - 0.01, height]} />
                    <meshStandardMaterial color="#2a2f37" metalness={0.6} roughness={0.4} alphaMap={alpha} alphaTest={0.45} side={THREE.DoubleSide} />
                </mesh>
                <mesh>
                    <planeGeometry args={[RACK_W - 0.01, height]} />
                    <meshStandardMaterial color="#283943" metalness={0.4} roughness={0.48} transparent opacity={0.21} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </Detailed>
            {[-1, 1].map((side) => <mesh key={`v${side}`} position={[RACK_W / 2 + side * (RACK_W / 2 - 0.016), 0, 0]}><boxGeometry args={[0.032, height, 0.018]} /><meshStandardMaterial color="#424b55" metalness={0.4} roughness={0.38} /></mesh>)}
            {[-1, 1].map((side) => <mesh key={`h${side}`} position={[RACK_W / 2, side * (height / 2 - 0.016), 0]}><boxGeometry args={[RACK_W, 0.032, 0.018]} /><meshStandardMaterial color="#424b55" metalness={0.4} roughness={0.38} /></mesh>)}
            {[-0.35, 0.35].map((y) => <mesh key={y} position={[0, y * height, 0]}><cylinderGeometry args={[0.008, 0.008, 0.065, 8]} /><meshStandardMaterial color="#848b93" metalness={0.85} roughness={0.3} /></mesh>)}
            <group position={[RACK_W - 0.038, 0, 0.011]}>
                <RoundedBox args={[0.038, 0.214, 0.013]} radius={0.006} smoothness={2}>
                    <meshStandardMaterial color="#1b2429" roughness={0.57} metalness={0.38} />
                </RoundedBox>
                <RoundedBox position={[0, 0.022, 0.017]} args={[0.022, 0.145, 0.018]} radius={0.006} smoothness={2}>
                    <meshStandardMaterial color="#909da3" roughness={0.31} metalness={0.77} />
                </RoundedBox>
                <mesh position={[0, -0.077, 0.009]} rotation-x={Math.PI / 2}>
                    <cylinderGeometry args={[0.009, 0.009, 0.004, 16]} />
                    <meshStandardMaterial color="#aab3b6" metalness={0.83} roughness={0.29} />
                </mesh>
                <mesh position={[0, -0.077, 0.0111]}>
                    <planeGeometry args={[0.002, 0.01]} /><meshBasicMaterial color="#293034" />
                </mesh>
            </group>
        </group>
    );
}

function UMark({ u, y }: { u: number; y: number }) {
    const tex = useLabelTexture(String(u), "#0f172a", "#e2e8f0", 64, 32);
    if (!tex) return null;
    return (
        <mesh position={[-(FACE_W / 2 + 0.012), y, FRONT_Z - 0.001]}>
            <planeGeometry args={[0.016, 0.008]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
    );
}

function Rails({ totalU, numbered }: { totalU: number; numbered: boolean }) {
    const h = totalU * U;
    const alpha = useMemo(() => repeated(railTexture(), 1, totalU), [totalU]);
    useEffect(() => () => alpha.dispose(), [alpha]);
    // Rail U numbers: every 5U plus 1 and top, focused rack only. Number
    // textures are refcounted ("1".."42" shared across racks), so this costs
    // ~10 small planes, not 42 textures per rack.
    const marks = useMemo(() => {
        const set = new Set<number>([1, totalU]);
        for (let u = 5; u < totalU; u += 5) set.add(u);
        return [...set].sort((a, b) => a - b);
    }, [totalU]);
    return (
        <>
            {[-1, 1].map((s) => (
                <mesh key={s} position={[s * (FACE_W / 2 + 0.012), PLINTH + h / 2, FRONT_Z - 0.002]}>
                    <planeGeometry args={[0.018, h]} />
                    <meshStandardMaterial color="#a8adb3" metalness={0.85} roughness={0.3} alphaMap={alpha} transparent side={THREE.DoubleSide} />
                </mesh>
            ))}
            {numbered && marks.map((u) => <UMark key={u} u={u} y={uToY(u) + U / 2} />)}
        </>
    );
}

function Sign({ planView, name, collision, height, occupied, total }: { planView: boolean; name: string; collision: boolean; height: number; occupied: number; total: number }) {
    const tex = useLabelTexture(collision ? `! ${name}` : name, collision ? "#b45309" : "#0f172a");
    if (!tex) return null;
    return (
        <group position={[0, height + 0.05, planView ? 0 : RACK_D / 2 - 0.05]} rotation-x={planView ? -Math.PI / 2 : 0}>
            <mesh position={[0, -0.004, -0.009]}>
                <boxGeometry args={[0.55, 0.086, 0.016]} />
                <meshStandardMaterial color="#27363f" roughness={0.42} metalness={0.62} />
            </mesh>
            {occupied > 0 && <mesh position={[-0.25 + 0.25 * occupied / total, -0.036, 0]}>
                <planeGeometry args={[0.5 * occupied / total, 0.005]} />
                <meshBasicMaterial color="#85d9cc" />
            </mesh>}
            <mesh>
                <planeGeometry args={[0.5, 0.0625]} />
                <meshBasicMaterial map={tex} toneMapped={false} />
            </mesh>
        </group>
    );
}

function BlankingFinish({ units }: { units: number }) {
    const map = useMemo(() => repeated(hardwareTexture("blank"), 1, units), [units]);
    useEffect(() => () => map.dispose(), [map]);
    return <meshStandardMaterial map={map} metalness={0.4} roughness={0.52} />;
}

function FreeSpace({ range, ghost, labelled }: { range: FreeRange; ghost: boolean; labelled: boolean }) {
    const h = range.size * U;
    const y = uToY(range.start) + h / 2;
    if (!ghost) {
        return (
            <mesh position={[0, y, FRONT_Z]}>
                <boxGeometry args={[FACE_W + 0.04, h - 0.001, 0.002]} />
                <BlankingFinish units={range.size} />
            </mesh>
        );
    }
    return (
        <group position={[0, y, FRONT_Z - 0.2]}>
            <mesh>
                <boxGeometry args={[FACE_W, h - 0.002, 0.4]} />
                <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} transparent opacity={0.18} depthWrite={false} />
            </mesh>
            {labelled && (
                <Html center position={[0, 0, 0.21]} style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
                    <div className="whitespace-nowrap rounded-sm bg-ops-success px-1.5 py-0.5 text-[10px] font-medium text-ops-status-fg">{range.size}U free</div>
                </Html>
            )}
        </group>
    );
}

export function RackCabinet({ planView = false, tracedPortId, placed, dark, focused, faded, showFree, accent, colorBy, selectedDeviceId, peerDeviceId, onFocus, onSelectDevice, floatCard, detailed = true }: {
    planView?: boolean;
    tracedPortId?: number | null;
    placed: PlacedRack<SceneRack>;
    dark: boolean;
    focused: boolean;
    faded: boolean;
    showFree: boolean;
    accent: string;
    colorBy: ColorBy;
    selectedDeviceId: number | null;
    peerDeviceId: number | null;
    onFocus: () => void;
    onSelectDevice: (d: FilteredDevice) => void;
    floatCard?: (d: FilteredDevice) => ReactNode;
    detailed?: boolean;
}) {
    const { rack } = placed;
    const totalU = rack.totalU || 42;
    const H = rackHeight(totalU);
    const body = H - PLINTH;
    const group = useRef<THREE.Group>(null);
    useFade(group, faded);

    const devices = rack.devices.filter((d) => inRack(d, totalU));
    const free = useMemo(() => freeRanges(totalU, rack.devices), [totalU, rack.devices]);
    const hasFault = rack.devices.some((d) => d.status === "NOT OK");
    // Beacon only while a critical device in this rack has a problem.
    const alarm = rack.devices.some((d) => criticalProblem(d));
    const steelColor = colorBy === "occupancy" ? OCCUPANCY_COLOR[occupancyBand(rack.occupiedU, totalU)] : dark ? "#434b54" : "#3d454d";
    const steel = <meshStandardMaterial color={steelColor} metalness={0.45} roughness={0.5} />;

    return (
        <group
            ref={group}
            position={[placed.x, 0, placed.z]}
            rotation-y={placed.rotationY}
            // Door/panels are hit before the devices behind them: only claim
            // the click while unfocused so a focused rack's devices get it.
            onClick={focused ? undefined : (e) => { e.stopPropagation(); onFocus(); }}
        >
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]} raycast={() => null}>
                <planeGeometry args={[RACK_W * 1.65, RACK_D * 1.5]} />
                <meshBasicMaterial alphaMap={radialTexture()} color="#14202a" transparent opacity={0.55} depthWrite={false} />
            </mesh>
            <mesh position={[0, PLINTH / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[RACK_W, PLINTH, RACK_D]} />
                {steel}
            </mesh>
            {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
                <mesh key={`${sx}${sz}`} position={[sx * (RACK_W / 2 - 0.02), PLINTH + body / 2, sz * (RACK_D / 2 - 0.02)]} castShadow>
                    <boxGeometry args={[0.04, body, 0.04]} />
                    {steel}
                </mesh>
            ))}
            {[-1, 1].map((s) => (
                <mesh key={s} position={[s * (RACK_W / 2 - 0.005), PLINTH + body / 2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[0.01, body, RACK_D - 0.08]} />
                    <meshStandardMaterial map={hardwareTexture("cabinet")} color={steelColor} metalness={0.53} roughness={0.43} />
                </mesh>
            ))}
            <mesh position={[0, H - 0.01, 0]} castShadow>
                <boxGeometry args={[RACK_W, 0.02, RACK_D]} />
                {steel}
            </mesh>

            <group position={[0, H + 0.001, -RACK_D * 0.12]} rotation-x={-Math.PI / 2}>
                <HousingGrille width={RACK_W * 0.76} height={RACK_D * 0.34} count={16} opacity={1} />
            </group>
            {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => <mesh key={`foot${x}${z}`} position={[x * 0.24, 0.015, z * 0.44]}><cylinderGeometry args={[0.03, 0.035, 0.03, 12]} /><meshStandardMaterial color="#8b9197" metalness={0.85} roughness={0.3} /></mesh>)}
            {/* Generic rear power rail decoration, not documented PSU inventory. */}
            <group position={[RACK_W / 2 - 0.07, PLINTH + body / 2, -RACK_D / 2 + 0.1]}>
                <mesh><boxGeometry args={[0.035, body * 0.85, 0.045]} /><meshStandardMaterial color="#161a1e" roughness={0.6} /></mesh>
                {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[0, (i - 3.5) * body / 10, 0.025]}><boxGeometry args={[0.018, 0.022, 0.003]} /><meshStandardMaterial color="#60666d" metalness={0.3} roughness={0.6} /></mesh>)}
            </group>
            <Rails totalU={totalU} numbered={focused} />
            <Sign planView={planView} name={rack.name} collision={placed.collision} height={H} occupied={totalU - free.reduce((slots, range) => slots + range.size, 0)} total={totalU} />

            {devices.map((d) => (
                <RackDevice
                    key={d.id}
                    device={d}
                    tracedPortId={selectedDeviceId === d.id ? tracedPortId : null}
                    // `selected` stays a single-device flag, so only the clicked
                    // device slides out on its rails; the peer just gets a card.
                    selected={d.id === selectedDeviceId}
                    faded={faded}
                    detailed={detailed || focused}
                    accent={accent}
                    colorBy={colorBy}
                    onSelect={onSelectDevice}
                    floatCard={d.id === selectedDeviceId || d.id === peerDeviceId ? floatCard?.(d) : undefined}
                />
            ))}
            {free.map((r) => (
                <FreeSpace key={r.start} range={r} ghost={showFree} labelled={focused || r.size >= 4} />
            ))}

            <Door height={body - 0.02} open={focused} />
            <group rotation-y={Math.PI}>
                <Door height={body - 0.02} open={false} />
            </group>

            {hasFault && (
                <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, RACK_D / 2 + 0.55]} material={sharedMaterials.pool}>
                    <planeGeometry args={[1.1, 0.9]} />
                </mesh>
            )}
            {alarm && (
                <mesh position={[0, H + 0.07, RACK_D / 2 - 0.22]} material={sharedMaterials.error}>
                    <cylinderGeometry args={[0.035, 0.035, 0.07, 16]} />
                </mesh>
            )}
        </group>
    );
}
