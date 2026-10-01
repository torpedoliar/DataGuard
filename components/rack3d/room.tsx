"use client";

import { useEffect, useMemo } from "react";
import { Instance, Instances, MeshReflectorMaterial } from "@react-three/drei";
import type { SceneRack } from "@/lib/rack-filter";
import type { RoomAppearance } from "@/lib/room-appearance";
import { ROOM_HEIGHT, TILE, rackHeight } from "./constants";
import { coldAisleTiles, floorPlanRect, roomRect, type Bounds, type PlacedRack } from "./layout";
import { floorTileTexture, perforatedTileTexture, repeated, wallpaperTexture } from "./textures";
import { useImageTexture } from "./use-image-texture";
import { useLabelTexture } from "./use-label-texture";

// Room temperature on the back wall near the ceiling; red when above the
// alert threshold. Manual reading from the daily audit, not live.
function TempLabel({ temp, x, z }: { temp: { tempC: number; thresholdC: number | null }; x: number; z: number }) {
    const over = temp.thresholdC != null && temp.tempC > temp.thresholdC;
    const text = `${temp.tempC.toFixed(1)} °C${temp.thresholdC != null ? ` / max ${temp.thresholdC} °C` : ""}`;
    const tex = useLabelTexture(text, over ? "#b91c1c" : "rgba(15,23,42,0.85)", "#f8fafc", 512, 64);
    if (!tex) return null;
    return (
        <mesh position={[x, ROOM_HEIGHT - 0.45, z]}>
            <planeGeometry args={[1.2, 0.15]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
    );
}

const WALL_REPEAT = 1; // metres per wallpaper repeat (tile mode)

// Four inward-facing walls + ceiling. Front faces only, so the camera still
// sees into the room from outside (same as the old back-side box).
function Walls({ r, dark, appearance }: { r: ReturnType<typeof roomRect>; dark: boolean; appearance: RoomAppearance }) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const custom = useImageTexture(appearance.wallpaper === "custom" ? appearance.wallpaperPath : null);
    const base = appearance.wallpaper === "custom" ? custom : appearance.wallpaper === "none" ? null : wallpaperTexture(appearance.wallpaper);
    const stretch = appearance.wallpaper === "custom" && appearance.wallpaperMode === "stretch";

    const walls = useMemo(() => [
        { len: w, pos: [cx, ROOM_HEIGHT / 2, r.z0] as const, rot: 0 },
        { len: w, pos: [cx, ROOM_HEIGHT / 2, r.z1] as const, rot: Math.PI },
        { len: d, pos: [r.x0, ROOM_HEIGHT / 2, cz] as const, rot: Math.PI / 2 },
        { len: d, pos: [r.x1, ROOM_HEIGHT / 2, cz] as const, rot: -Math.PI / 2 },
    ], [w, d, cx, cz, r.x0, r.x1, r.z0, r.z1]);
    const maps = useMemo(
        () => (base ? walls.map((wall) => (stretch ? repeated(base, 1, 1) : repeated(base, wall.len / WALL_REPEAT, ROOM_HEIGHT / WALL_REPEAT))) : null),
        [base, stretch, walls],
    );
    useEffect(() => () => maps?.forEach((t) => t.dispose()), [maps]);

    const plain = dark ? "#1b222c" : "#c9ced4";
    const tint = dark ? "#8f99a8" : "#ffffff"; // darkens the finish in dark mode
    return (
        <>
            {walls.map((wall, i) => (
                <mesh key={i} position={[...wall.pos]} rotation-y={wall.rot}>
                    <planeGeometry args={[wall.len, ROOM_HEIGHT]} />
                    <meshStandardMaterial color={maps ? tint : plain} map={maps?.[i] ?? null} roughness={0.9} />
                </mesh>
            ))}
            <mesh position={[cx, ROOM_HEIGHT, cz]} rotation-x={Math.PI / 2}>
                <planeGeometry args={[w, d]} />
                <meshStandardMaterial color={plain} roughness={0.9} />
            </mesh>
        </>
    );
}

function CableTrays({ placed }: { placed: PlacedRack<SceneRack>[] }) {
    const rows = useMemo(() => {
        const byRow = new Map<string, PlacedRack<SceneRack>[]>();
        for (const p of placed) byRow.set(`${p.row}:${p.z.toFixed(3)}`, [...(byRow.get(`${p.row}:${p.z.toFixed(3)}`) ?? []), p]);
        return [...byRow.values()].map((list) => {
            const xs = list.map((p) => p.x);
            return {
                z: list[0].z,
                x0: Math.min(...xs) - 0.4,
                x1: Math.max(...xs) + 0.4,
                y: Math.max(...list.map((p) => rackHeight(p.rack.totalU || 42))) + 0.35,
            };
        });
    }, [placed]);

    return (
        <>
            {rows.map((r, i) => {
                const len = r.x1 - r.x0;
                const cx = (r.x0 + r.x1) / 2;
                const rungs = Math.max(2, Math.floor(len / 0.25));
                return (
                    <group key={i} position={[cx, r.y, r.z]}>
                        {[-0.15, 0.15].map((dz) => (
                            <mesh key={dz} position={[0, 0, dz]} castShadow>
                                <boxGeometry args={[len, 0.05, 0.01]} />
                                <meshStandardMaterial color="#eab308" metalness={0.3} roughness={0.5} />
                            </mesh>
                        ))}
                        <Instances limit={rungs}>
                            <boxGeometry args={[0.012, 0.01, 0.3]} />
                            <meshStandardMaterial color="#ca8a04" metalness={0.3} roughness={0.5} />
                            {Array.from({ length: rungs }, (_, k) => (
                                <Instance key={k} position={[-len / 2 + (k + 0.5) * (len / rungs), -0.02, 0]} />
                            ))}
                        </Instances>
                        {[-len / 2 + 0.05, len / 2 - 0.05].map((x) => (
                            <mesh key={x} position={[x, (ROOM_HEIGHT - r.y) / 2, 0]}>
                                <cylinderGeometry args={[0.006, 0.006, ROOM_HEIGHT - r.y, 6]} />
                                <meshStandardMaterial color="#6b7280" metalness={0.8} roughness={0.3} />
                            </mesh>
                        ))}
                    </group>
                );
            })}
        </>
    );
}

export function Room({ placed, b, floorPlanUrl, dark, reflections, temp, appearance }: {
    placed: PlacedRack<SceneRack>[];
    b: Bounds;
    floorPlanUrl: string | null;
    dark: boolean;
    reflections: boolean;
    temp: { tempC: number; thresholdC: number | null } | null;
    appearance: RoomAppearance;
}) {
    const r = roomRect(b);
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const floorTex = useMemo(() => repeated(floorTileTexture(dark), w / TILE, d / TILE), [dark, w, d]);
    const plan = useImageTexture(floorPlanUrl);
    const planImg = plan?.image as { width: number; height: number } | undefined;
    const planRect = planImg ? floorPlanRect(b, planImg.width / planImg.height) : null;
    const cold = useMemo(() => [...coldAisleTiles(placed)].map((k) => k.split(",").map(Number) as [number, number]), [placed]);
    const panels = useMemo(() => {
        const out: [number, number][] = [];
        for (let x = r.x0 + 0.9; x < r.x1; x += 1.8) for (let z = r.z0 + 1.2; z < r.z1; z += 2.4) out.push([x, z]);
        return out;
    }, [r.x0, r.x1, r.z0, r.z1]);

    return (
        <group>
            <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} receiveShadow>
                <planeGeometry args={[w, d]} />
                {reflections ? (
                    <MeshReflectorMaterial
                        map={floorTex}
                        resolution={512}
                        blur={[300, 80]}
                        mixBlur={1}
                        mixStrength={dark ? 1.4 : 0.6}
                        mirror={0}
                        depthScale={0.6}
                        minDepthThreshold={0.4}
                        maxDepthThreshold={1.2}
                        roughness={0.75}
                        metalness={0.2}
                    />
                ) : (
                    <meshStandardMaterial map={floorTex} roughness={0.8} metalness={0.1} />
                )}
            </mesh>

            {plan && planRect ? (
                <mesh rotation-x={-Math.PI / 2} position={[planRect.cx, 0.003, planRect.cz]} receiveShadow>
                    <planeGeometry args={[planRect.width, planRect.depth]} />
                    <meshStandardMaterial map={plan} roughness={0.9} />
                </mesh>
            ) : (
                <Instances limit={Math.max(1, cold.length)} receiveShadow>
                    <planeGeometry args={[TILE, TILE]} />
                    <meshStandardMaterial
                        map={perforatedTileTexture(dark)}
                        roughness={0.7}
                        emissive="#1e3a8a"
                        emissiveIntensity={dark ? 0.35 : 0}
                    />
                    {cold.map(([ix, iz]) => (
                        <Instance key={`${ix},${iz}`} position={[ix * TILE, 0.002, iz * TILE]} rotation={[-Math.PI / 2, 0, 0]} />
                    ))}
                </Instances>
            )}

            <Walls r={r} dark={dark} appearance={appearance} />

            {panels.map(([x, z]) => (
                <mesh key={`${x},${z}`} position={[x, ROOM_HEIGHT - 0.02, z]} rotation-x={Math.PI / 2}>
                    <planeGeometry args={[0.6, 1.2]} />
                    <meshBasicMaterial color={appearance.lightColor ?? (dark ? "#d9e3f2" : "#ffffff")} toneMapped={false} />
                </mesh>
            ))}

            {temp && <TempLabel temp={temp} x={cx} z={r.z0 + 0.02} />}
            <CableTrays placed={placed} />
        </group>
    );
}
