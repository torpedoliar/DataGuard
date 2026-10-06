"use client";

import { useEffect, useMemo } from "react";
import { Instance, Instances, RoundedBox } from "@react-three/drei";
import type { FilteredDevice } from "@/lib/rack-filter";
import { FACE_W, U } from "./constants";
import { deviceKind, type DeviceKind } from "./device-kind";
import { ledMaterial, portMaterials, sharedMaterials } from "./materials";
import { portFace, type PortFaceSlot } from "./port-face";
import { repeated, ventTexture } from "./textures";
import { useLabelTexture } from "./use-label-texture";
import { useImageTexture } from "./use-image-texture";
import { FacilityModel } from "./facility-model";

const FRONT_Z = 0.36;
// Device opacity is React-driven (filter mute x rack fade); tells useFade to skip it.
const OWN_FADE = { ownFade: true };
export const deviceOpacity = (opacity: number) => ({ userData: OWN_FADE, transparent: opacity < 1, opacity });
export const CHASSIS_D = 0.72;
type Vec3 = [number, number, number];

const FACE_COLOR: Record<DeviceKind, string> = {
    server: "#6c747d", network: "#737c85", storage: "#66717b", power: "#707780", cooling: "#727c85",
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

function Vent({ x, w, h, opacity }: { x: number; w: number; h: number; opacity: number }) {
    const alpha = useMemo(() => repeated(ventTexture(), w / 0.05, h / 0.05), [w, h]);
    useEffect(() => () => alpha.dispose(), [alpha]);
    return (
        <mesh position={[x, 0, 0.0008]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial {...deviceOpacity(opacity)} color="#07080a" alphaMap={alpha} alphaTest={0.5} />
        </mesh>
    );
}

function ServerFace({ uh, h, opacity }: { uh: number; h: number; opacity: number }) {
    const rows = uh >= 2 ? 2 : 1;
    const cols = uh >= 2 ? 12 : 8;
    const bh = (h * 0.78) / rows - 0.002;
    const bw = 0.0165;
    const bays = grid(cols, rows, -0.05, 0.2, bh);
    return (
        <>
            <Vent opacity={opacity} x={-0.15} w={0.12} h={h * 0.6} />
            <Instances frustumCulled={false} limit={bays.length}>
                <boxGeometry args={[bw, bh, 0.003]} />
                <meshStandardMaterial {...deviceOpacity(opacity)} color="#111316" metalness={0.4} roughness={0.6} />
                {bays.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
            <Instances frustumCulled={false} limit={bays.length}>
                <boxGeometry args={[bw * 0.7, 0.002, 0.002]} /><meshStandardMaterial {...deviceOpacity(opacity)} color="#9ea6ae" metalness={0.85} roughness={0.35} />
                {bays.map(([x, y], i) => <Instance key={i} position={[x, y - bh * 0.3, 0.003]} />)}
            </Instances>
            <Instances frustumCulled={false} limit={bays.length} material={sharedMaterials.activity}>
                <boxGeometry args={[0.003, 0.0015, 0.001]} />
                {bays.map(([x, y], i) => <Instance key={i} position={[x + bw * 0.3, y + bh / 2 - 0.003, 0.0025]} />)}
            </Instances>
        </>
    );
}

function NetworkFace({ h, opacity }: { h: number; opacity: number }) {
    const ports = grid(24, 2, -0.2, 0.12, Math.min(0.0085, h * 0.3));
    const sfp = grid(4, 1, 0.135, 0.205, 0.009);
    return (
        <>
            <Instances frustumCulled={false} limit={ports.length}>
                <boxGeometry args={[0.011, Math.min(0.0085, h * 0.3), 0.003]} />
                <meshStandardMaterial {...deviceOpacity(opacity)} color="#0a0b0c" roughness={0.8} />
                {ports.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
            <Instances frustumCulled={false} limit={sfp.length}>
                <boxGeometry args={[0.014, 0.0095, 0.004]} />
                <meshStandardMaterial {...deviceOpacity(opacity)} color="#9aa0a6" metalness={0.9} roughness={0.25} />
                {sfp.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
        </>
    );
}

// The device's documented ports (network docs): real count and layout, link
// LED lit + flickering only on Active ports, red on Down, dark otherwise.
// Interaction belongs to RackDevice and the hologram, not this shared model.
export function DocumentedPorts({ slots, opacity }: { slots: PortFaceSlot[]; opacity: number }) {
    const groups = useMemo(() => ({
        jacks: slots,
        lit: [0, 1, 2].map((ph) => slots.filter((p) => p.state === "active" && p.phase === ph)),
        down: slots.filter((p) => p.state === "down"),
    }), [slots]);
    const led = (p: PortFaceSlot): Vec3 => [p.x - p.w * 0.3, p.y + p.h * 0.36, 0.005];
    return (
        <>
            <Instances frustumCulled={false} limit={groups.jacks.length}>
                <boxGeometry args={[1, 1, 0.004]} />
                <meshStandardMaterial {...deviceOpacity(opacity)} color="#929ba3" metalness={0.85} roughness={0.35} />
                {groups.jacks.map((p, i) => <Instance key={i} position={[p.x, p.y, 0.001]} scale={[p.w + 0.0015, p.h + 0.0015, 1]} />)}
            </Instances>
            <Instances frustumCulled={false} limit={groups.jacks.length}>
                <boxGeometry args={[1, 1, 0.003]} />
                <meshStandardMaterial {...deviceOpacity(opacity)} color="#0a0b0c" roughness={0.8} />
                {groups.jacks.map((p, i) => (
                    <Instance key={i} position={[p.x, p.y, 0.0025]} scale={[p.w, p.h, 1]} color={p.uplink ? "#8f969d" : "#ffffff"} />
                ))}
            </Instances>
            {groups.lit.map((list, ph) => list.length > 0 && (
                <Instances key={ph} frustumCulled={false} limit={list.length} material={portMaterials[ph]}>
                    <boxGeometry args={[0.0022, 0.0014, 0.001]} />
                    {list.map((p, i) => <Instance key={i} position={led(p)} />)}
                </Instances>
            ))}
            {groups.down.length > 0 && (
                <Instances frustumCulled={false} limit={groups.down.length} material={sharedMaterials.portDown}>
                    <boxGeometry args={[0.0022, 0.0014, 0.001]} />
                    {groups.down.map((p, i) => <Instance key={i} position={led(p)} />)}
                </Instances>
            )}
        </>
    );
}

function StorageFace({ uh, h, opacity }: { uh: number; h: number; opacity: number }) {
    const rows = uh >= 2 ? 3 : 1;
    const th = (h * 0.85) / rows - 0.002;
    const trays = grid(4, rows, -0.2, 0.2, th);
    return (
        <>
            <Instances frustumCulled={false} limit={trays.length}>
                <boxGeometry args={[0.095, th, 0.004]} />
                <meshStandardMaterial {...deviceOpacity(opacity)} color="#1a1d21" metalness={0.5} roughness={0.45} />
                {trays.map((p, i) => <Instance key={i} position={p} />)}
            </Instances>
            <Instances frustumCulled={false} limit={trays.length}>
                <boxGeometry args={[0.07, Math.min(0.003, th / 5), 0.004]} /><meshStandardMaterial {...deviceOpacity(opacity)} color="#747d86" metalness={0.85} roughness={0.32} />
                {trays.map(([x, y], i) => <Instance key={i} position={[x, y - th * 0.25, 0.005]} />)}
            </Instances>
            <Instances frustumCulled={false} limit={trays.length} material={sharedMaterials.storage}>
                <boxGeometry args={[0.003, 0.003, 0.001]} />
                {trays.map(([x, y], i) => <Instance key={i} position={[x + 0.04, y, 0.0025]} />)}
            </Instances>
        </>
    );
}

function PowerFace({ h, opacity }: { h: number; opacity: number }) {
    return (
        <>
            <Vent opacity={opacity} x={0.06} w={0.3} h={h * 0.75} />
            <mesh position={[-0.15, 0, 0.001]} material={sharedMaterials.lcd}>
                <planeGeometry args={[0.07, Math.min(0.03, h * 0.5)]} />
            </mesh>
        </>
    );
}

function Faceplate({ device, kind, uh, h, opacity, glow }: { device: FilteredDevice; kind: DeviceKind; uh: number; h: number; opacity: number; glow: string | null }) {
    const ports = useMemo(() => portFace(device, h), [device, h]);
    return (
        <group position={[0, 0, FRONT_Z + 0.0015]}>
            <mesh>
                <planeGeometry args={[FACE_W, h]} />
                <meshStandardMaterial userData={OWN_FADE} color={FACE_COLOR[kind]} metalness={0.35} roughness={0.42} transparent={opacity < 1} opacity={opacity} emissive={glow ?? "#000000"} emissiveIntensity={glow ? 0.08 : 0} />
            </mesh>
            {ports ? <DocumentedPorts opacity={opacity} slots={ports.slots} /> : (
                <>
                    {kind === "server" && <ServerFace opacity={opacity} uh={uh} h={h} />}
                    {kind === "network" && <NetworkFace opacity={opacity} h={h} />}
                </>
            )}
            {!ports && kind === "storage" && <StorageFace opacity={opacity} uh={uh} h={h} />}
            {!ports && kind === "power" && <PowerFace opacity={opacity} h={h} />}
            {!ports && kind === "cooling" && <Vent opacity={opacity} x={0} w={FACE_W * 0.9} h={h * 0.8} />}
        </group>
    );
}

// Thin amber frame on the faceplate of every critical device (quiet marker).
function CriticalFrame({ h }: { h: number }) {
    const t = 0.0015;
    return (
        <group position={[0, 0, FRONT_Z + 0.0025]}>
            {[h / 2 - t / 2, -h / 2 + t / 2].map((y) => (
                <mesh key={`h${y}`} position={[0, y, 0]} material={sharedMaterials.critical}>
                    <planeGeometry args={[FACE_W, t]} />
                </mesh>
            ))}
            {[FACE_W / 2 - t / 2, -FACE_W / 2 + t / 2].map((x) => (
                <mesh key={`v${x}`} position={[x, 0, 0]} material={sharedMaterials.critical}>
                    <planeGeometry args={[t, h]} />
                </mesh>
            ))}
        </group>
    );
}

function NameTag({ device, h, opacity }: { device: FilteredDevice; h: number; opacity: number }) {
    const labelH = Math.min(0.012, h * 0.3);
    const label = useLabelTexture(
        device.isCritical ? `⚠ ${device.name}` : device.name,
        device.isCritical ? "rgba(146,64,14,0.92)" : "rgba(15,23,42,0.85)",
    );
    const logo = useImageTexture(device.brandLogo);
    const logoImg = logo?.image as { width: number; height: number } | undefined;
    const logoW = logoImg ? Math.min(0.05, labelH * 1.4 * (logoImg.width / logoImg.height)) : 0;
    const x = -FACE_W / 2 + 0.08;
    const y = h / 2 - labelH / 2 - 0.003;
    return (
        <group position={[0, 0, FRONT_Z + 0.0035]}>
            <mesh position={[x, y, 0]}>
                <planeGeometry args={[0.13, labelH]} />
                <meshBasicMaterial userData={OWN_FADE} map={label} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            {logo && (
                <mesh position={[x + 0.065 + 0.006 + logoW / 2, y, 0]}>
                    <planeGeometry args={[logoW, labelH * 1.4]} />
                    <meshBasicMaterial userData={OWN_FADE} map={logo} transparent opacity={opacity} toneMapped={false} />
                </mesh>
            )}
        </group>
    );
}

export function DeviceModel({ device, opacity = 1, glow = null, marker = "#64748b", detailed = true }: {
    device: FilteredDevice; opacity?: number; glow?: string | null; marker?: string; detailed?: boolean;
}) {
    if (device.assetType === "pac" || device.assetType === "ups") return <FacilityModel device={device} opacity={opacity} detailed={detailed} />;
    const uh = device.uHeight || 1;
    const h = uh * U - 0.0015;
    const kind = deviceKind(device.categoryName, device.name);
    return (
        <group>
            {detailed ? (
                <RoundedBox args={[FACE_W, h, CHASSIS_D]} radius={0.002} smoothness={2} castShadow receiveShadow>
                    <meshStandardMaterial {...deviceOpacity(opacity)} color="#858d95" metalness={0.35} roughness={0.42} />
                </RoundedBox>
            ) : (
                <mesh castShadow receiveShadow>
                    <boxGeometry args={[FACE_W, h, CHASSIS_D]} />
                    <meshStandardMaterial {...deviceOpacity(opacity)} color="#858d95" metalness={0.35} roughness={0.42} />
                </mesh>
            )}
            {[-1, 1].map((s) => (
                <group key={s} position={[s * (FACE_W / 2 + 0.011), 0, FRONT_Z]}>
                    <mesh><boxGeometry args={[0.022, h, 0.004]} /><meshStandardMaterial userData={OWN_FADE} color="#8b9197" metalness={0.85} roughness={0.35} transparent={opacity < 1} opacity={opacity} /></mesh>
                    {detailed && [-1, 1].map((y) => <mesh key={y} position={[0, y * Math.max(0.006, h / 2 - 0.008), 0.003]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.003, 0.003, 0.002, 8]} /><meshStandardMaterial {...deviceOpacity(opacity)} color="#525960" metalness={0.9} roughness={0.3} /></mesh>)}
                    <mesh position={[0, 0, 0.003]}><boxGeometry args={[0.009, Math.min(0.009, h / 3), 0.001]} /><meshStandardMaterial {...deviceOpacity(opacity)} color={marker} /></mesh>
                </group>
            ))}
            <Faceplate device={device} kind={kind} uh={uh} h={h} opacity={opacity} glow={glow} />
            <NameTag device={device} h={h} opacity={opacity} />
            {device.isCritical && <CriticalFrame h={h} />}
            <mesh position={[FACE_W / 2 - 0.012, h / 2 - Math.min(0.008, h / 4), FRONT_Z + 0.003]} material={ledMaterial(device.status)}><sphereGeometry args={[0.0022, 12, 8]} /></mesh>
        </group>
    );
}
