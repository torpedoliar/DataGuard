"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ScreenHtml as Html } from "./screen-html";
import type { FilteredDevice } from "@/lib/rack-filter";
import { AUDIT_COLOR, SEVERITY_COLOR, type ColorBy, type OpenIncidents } from "@/lib/rack-signals";
import { FACE_W, FRONT_Z, RACK_W, SLIDE, U, uToY } from "./constants";
import { DeviceModel, CHASSIS_D } from "./device-model";
import { useLabelTexture } from "./use-label-texture";
import { chassisCoverTexture } from "./textures";
import { portFace } from "./port-face";
import { FADE } from "./use-fade";

// Open-incident count beside the rack at the device's height, coloured by
// the worst open severity. A texture plane, not <Html>: no DOM per badge.
function IncidentBadge({ incidents, h }: { incidents: OpenIncidents; h: number }) {
    const tex = useLabelTexture(String(incidents.count), SEVERITY_COLOR[incidents.maxSeverity ?? "Low"], "#ffffff", 64, 32);
    if (!tex) return null;
    return (
        <mesh position={[RACK_W / 2 + 0.035, 0, FRONT_Z]}>
            <planeGeometry args={[0.05, Math.min(0.025, h * 0.9)]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
    );
}

export function RackDevice({ device, tracedPortId, selected, faded, accent, colorBy, onSelect, floatCard, detailed = true }: {
    tracedPortId?: number | null;
    device: FilteredDevice;
    selected: boolean;
    faded: boolean;
    accent: string;
    colorBy: ColorBy;
    onSelect: (d: FilteredDevice) => void;
    floatCard?: ReactNode;
    detailed?: boolean;
}) {
    const uh = device.uHeight || 1;
    const h = uh * U - 0.0015;
    const y = uToY(device.rackPosition ?? 1) + (uh * U) / 2;
    const opacity = (device.isMuted ? 0.12 : 1) * (faded ? FADE : 1);
    const port = tracedPortId == null ? null : portFace(device, h)?.slots.find((s) => s.portId === tracedPortId);
    const earColor = colorBy === "audit" ? AUDIT_COLOR[device.status ?? "Pending"] : device.categoryColor || "#64748b";
    const slider = useRef<THREE.Group>(null);
    const [hovered, setHovered] = useState(false);
    const invalidate = useThree((s) => s.invalidate);

    useEffect(() => () => { document.body.style.cursor = ""; }, []);

    // Slide out on its rails when selected.
    useFrame((_, dt) => {
        const g = slider.current;
        if (!g) return;
        const target = selected ? SLIDE : 0;
        g.position.z = THREE.MathUtils.damp(g.position.z, target, 10, dt);
        if (Math.abs(g.position.z - target) > 0.0005) invalidate();
    });

    const over = (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
    };
    const out = () => {
        setHovered(false);
        document.body.style.cursor = "";
    };

    return (
        <group position={[0, y, 0]}>
            <group ref={slider}>
                <mesh position={[0, 0, FRONT_Z - CHASSIS_D / 2 + 0.012]} onPointerOver={over} onPointerOut={out} onClick={(e) => { e.stopPropagation(); onSelect(device); }}>
                    <boxGeometry args={[FACE_W + 0.046, h + 0.0005, CHASSIS_D + 0.025]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
                {port && <mesh position={[port.x, port.y, FRONT_Z + 0.008]} raycast={() => null}>
                    <planeGeometry args={[port.w, port.h]} />
                    <meshBasicMaterial color="#69ffdd" toneMapped={false} />
                </mesh>}
                {selected && device.assetType !== "ups" && device.assetType !== "pac" && (
                    <group position={[0, h / 2 + 0.0004, FRONT_Z - CHASSIS_D / 2]}>
                        <mesh rotation-x={-Math.PI / 2}>
                            <planeGeometry args={[FACE_W - 0.004, CHASSIS_D - 0.004]} />
                            <meshStandardMaterial map={chassisCoverTexture()} roughness={0.47} metalness={0.52} transparent={opacity < 1} opacity={opacity} userData={{ ownFade: true }} />
                        </mesh>
                        {[-1, 1].map((side) => (
                            <mesh key={side} position={[side * (FACE_W / 2 + 0.003), -h * 0.65, 0]}>
                                <boxGeometry args={[0.006, Math.min(0.016, h / 3), CHASSIS_D - 0.025]} />
                                <meshStandardMaterial color="#acb8bd" roughness={0.28} metalness={0.8} transparent={opacity < 1} opacity={opacity} userData={{ ownFade: true }} />
                            </mesh>
                        ))}
                    </group>
                )}
                <group position={[0, 0, FRONT_Z - CHASSIS_D / 2]} raycast={() => null}>
                    <DeviceModel device={device} opacity={opacity} marker={earColor} glow={hovered || selected ? accent : null} detailed={detailed || selected || floatCard != null} />
                </group>
            </group>
            {device.openIncidents.count > 0 && <IncidentBadge incidents={device.openIncidents} h={h} />}
            {floatCard != null && (
                <Html position={[0, h + 0.06, FRONT_Z]} center zIndexRange={[40, 0]}>
                    {floatCard}
                </Html>
            )}
            {/* Screen-space Html ignores the pointerEvents prop; set the DOM
                style so the tooltip cannot steal hover and repeatedly disappear. */}
            {hovered && !selected && (
                <Html position={[0, h / 2 + 0.02, FRONT_Z]} center style={{ pointerEvents: "none" }} zIndexRange={[40, 0]}>
                    <div className="whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-[11px] font-medium text-white shadow">
                        {device.name} · U{device.rackPosition} · {uh}U
                    </div>
                </Html>
            )}
        </group>
    );
}
