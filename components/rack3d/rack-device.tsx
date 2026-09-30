"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Instance, Instances } from "@react-three/drei";
import type { FilteredDevice } from "@/lib/rack-filter";
import { FACE_W, FRONT_Z, U, uToY } from "./constants";
import { deviceKind, type DeviceKind } from "./device-kind";
import { ledMaterial, sharedMaterials } from "./materials";
import { labelTexture, repeated, ventTexture } from "./textures";
import { useImageTexture } from "./use-image-texture";

const CHASSIS_D = 0.72;
const SLIDE = 0.3;
type Vec3 = [number, number, number];

const FACE_COLOR: Record<DeviceKind, string> = {
    server: "#3a3f47", network: "#2c3036", storage: "#343941", power: "#3d4148", cooling: "#393d43",
};

// cols x rows cell centres across [x0, x1], vertically centred.
function grid(cols: number, rows: number, x0: number, x1: number, cellH: number, gap = 0.002): Vec3[] {
    const pitch = (x1 - x0) / cols;
    const startY = (-rows * (cellH + gap)) / 2;
    const out: Vec3[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        out.push([x0 + pitch * (c + 0.5), startY + (cellH + gap) * (r + 0.5), 0]);
    }
    return out;
}

function Vent({ x, w, h }: { x: number; w: number; h: number }) {
    const alpha = useMemo(() => repeated(ventTexture(), w / 0.05, h / 0.05), [w, h]);
    return (
        <mesh position={[x, 0, 0.0008]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color="#07080a" alphaMap={alpha} transparent />
        </mesh>
    );
}

function ServerFace({ uh, h }: { uh: number; h: number }) {
    const rows = uh >= 2 ? 2 : 1;
    const cols = uh >= 2 ? 12 : 8;
    const bh = (h * 0.78) / rows - 0.002;
    const bw = 0.0165;
    const bays = grid(cols, rows, -0.05, 0.2, bh);
    return (
        <>
            <Vent x={-0.15} w={0.12} h={h * 0.6} />
            <Instances limit={bays.length}>
                <boxGeometry args={[bw, bh, 0.003]} />
                <meshStandardMaterial color="#111316" metalness={0.4} roughness={0.6} />
                {bays.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
            <Instances limit={bays.length} material={sharedMaterials.activity}>
                <boxGeometry args={[0.003, 0.0015, 0.001]} />
                {bays.map(([x, y], i) => <Instance key={i} position={[x + bw * 0.3, y + bh / 2 - 0.003, 0.0025]} />)}
            </Instances>
        </>
    );
}

function NetworkFace({ h }: { h: number }) {
    const ports = grid(24, 2, -0.2, 0.12, Math.min(0.0085, h * 0.3));
    const sfp = grid(4, 1, 0.135, 0.205, 0.009);
    return (
        <>
            <Instances limit={ports.length}>
                <boxGeometry args={[0.011, Math.min(0.0085, h * 0.3), 0.003]} />
                <meshStandardMaterial color="#0a0b0c" roughness={0.8} />
                {ports.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
            {[sharedMaterials.linkA, sharedMaterials.linkB].map((mat, k) => (
                <Instances key={k} limit={ports.length} material={mat}>
                    <boxGeometry args={[0.0022, 0.0014, 0.001]} />
                    {ports.filter((_, i) => i % 2 === k).map(([x, y], i) => <Instance key={i} position={[x - 0.003, y + 0.0055, 0.0022]} />)}
                </Instances>
            ))}
            <Instances limit={sfp.length}>
                <boxGeometry args={[0.014, 0.0095, 0.004]} />
                <meshStandardMaterial color="#9aa0a6" metalness={0.9} roughness={0.25} />
                {sfp.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
        </>
    );
}

function StorageFace({ uh, h }: { uh: number; h: number }) {
    const rows = uh >= 2 ? 3 : 1;
    const th = (h * 0.85) / rows - 0.002;
    const trays = grid(4, rows, -0.2, 0.2, th);
    return (
        <>
            <Instances limit={trays.length}>
                <boxGeometry args={[0.095, th, 0.004]} />
                <meshStandardMaterial color="#1a1d21" metalness={0.5} roughness={0.45} />
                {trays.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
            <Instances limit={trays.length} material={sharedMaterials.storage}>
                <boxGeometry args={[0.003, 0.003, 0.001]} />
                {trays.map(([x, y], i) => <Instance key={i} position={[x + 0.04, y, 0.0025]} />)}
            </Instances>
        </>
    );
}

function PowerFace({ h }: { h: number }) {
    return (
        <>
            <Vent x={0.06} w={0.3} h={h * 0.75} />
            <mesh position={[-0.15, 0, 0.001]} material={sharedMaterials.lcd}>
                <planeGeometry args={[0.07, Math.min(0.03, h * 0.5)]} />
            </mesh>
        </>
    );
}

function Faceplate({ kind, uh, h, opacity, glow }: { kind: DeviceKind; uh: number; h: number; opacity: number; glow: string | null }) {
    return (
        <group position={[0, 0, FRONT_Z + 0.0015]}>
            <mesh>
                <planeGeometry args={[FACE_W, h]} />
                <meshStandardMaterial color={FACE_COLOR[kind]} metalness={0.6} roughness={0.35} transparent={opacity < 1} opacity={opacity} emissive={glow ?? "#000000"} emissiveIntensity={glow ? 0.35 : 0} />
            </mesh>
            {kind === "server" && <ServerFace uh={uh} h={h} />}
            {kind === "network" && <NetworkFace h={h} />}
            {kind === "storage" && <StorageFace uh={uh} h={h} />}
            {kind === "power" && <PowerFace h={h} />}
            {kind === "cooling" && <Vent x={0} w={FACE_W * 0.9} h={h * 0.8} />}
        </group>
    );
}

function NameTag({ device, h, opacity }: { device: FilteredDevice; h: number; opacity: number }) {
    const labelH = Math.min(0.012, h * 0.3);
    const label = useMemo(() => labelTexture(device.name, "rgba(15,23,42,0.85)"), [device.name]);
    const logo = useImageTexture(device.brandLogo);
    const logoImg = logo?.image as { width: number; height: number } | undefined;
    const logoW = logoImg ? Math.min(0.05, labelH * 1.4 * (logoImg.width / logoImg.height)) : 0;
    const x = -FACE_W / 2 + 0.08;
    const y = h / 2 - labelH / 2 - 0.003;
    return (
        <group position={[0, 0, FRONT_Z + 0.0035]}>
            <mesh position={[x, y, 0]}>
                <planeGeometry args={[0.13, labelH]} />
                <meshBasicMaterial map={label} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            {logo && (
                <mesh position={[x + 0.065 + 0.006 + logoW / 2, y, 0]}>
                    <planeGeometry args={[logoW, labelH * 1.4]} />
                    <meshBasicMaterial map={logo} transparent opacity={opacity} toneMapped={false} />
                </mesh>
            )}
        </group>
    );
}

export function RackDevice({ device, selected, accent, onSelect }: {
    device: FilteredDevice;
    selected: boolean;
    accent: string;
    onSelect: (d: FilteredDevice) => void;
}) {
    const uh = device.uHeight || 1;
    const h = uh * U - 0.0015;
    const y = uToY(device.rackPosition ?? 1) + (uh * U) / 2;
    const kind = deviceKind(device.categoryName, device.name);
    const opacity = device.isMuted ? 0.12 : 1;
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
                <mesh
                    position={[0, 0, FRONT_Z - CHASSIS_D / 2]}
                    castShadow
                    receiveShadow
                    onPointerOver={over}
                    onPointerOut={out}
                    onClick={(e) => { e.stopPropagation(); onSelect(device); }}
                >
                    <boxGeometry args={[FACE_W, h, CHASSIS_D]} />
                    <meshStandardMaterial color="#1c1f24" metalness={0.55} roughness={0.45} transparent={opacity < 1} opacity={opacity} />
                </mesh>
                {/* 19" mounting ears carry the category colour */}
                {[-1, 1].map((s) => (
                    <mesh key={s} position={[s * (FACE_W / 2 + 0.011), 0, FRONT_Z + 0.001]}>
                        <boxGeometry args={[0.022, h, 0.003]} />
                        <meshStandardMaterial color={device.categoryColor || "#64748b"} metalness={0.3} roughness={0.4} transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                ))}
                <Faceplate kind={kind} uh={uh} h={h} opacity={opacity} glow={hovered || selected ? accent : null} />
                <NameTag device={device} h={h} opacity={opacity} />
                <mesh position={[FACE_W / 2 - 0.012, h / 2 - Math.min(0.008, h / 4), FRONT_Z + 0.003]} material={ledMaterial(device.status)}>
                    <sphereGeometry args={[0.0022, 12, 8]} />
                </mesh>
            </group>
            {hovered && (
                <Html position={[0, h / 2 + 0.02, FRONT_Z]} center pointerEvents="none" zIndexRange={[40, 0]}>
                    <div className="whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-[11px] font-medium text-white shadow">
                        {device.name} · U{device.rackPosition} · {uh}U
                    </div>
                </Html>
            )}
        </group>
    );
}
