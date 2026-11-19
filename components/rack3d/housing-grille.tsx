"use client";

import { Instance, Instances } from "@react-three/drei";

// A recessed opening with angled, individually lit sheet-metal blades.
// Dimensions refer to the opening in local XY, facing forward along Z.
export function HousingGrille({ width, height, count, opacity, color = "#657079" }: {
    width: number; height: number; count: number; opacity: number; color?: string;
}) {
    const pitch = height / count;
    const fade = { transparent: opacity < 1, opacity, userData: { ownFade: true } };
    return <group>
        <mesh>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial {...fade} color="#141c21" roughness={0.85} />
        </mesh>
        <Instances limit={count} frustumCulled={false}>
            <boxGeometry args={[width * 0.965, pitch * 0.68, Math.min(pitch * 0.15, 0.004)]} />
            <meshStandardMaterial {...fade} color={color} roughness={0.39} metalness={0.62} />
            {Array.from({ length: count }, (_, i) => (
                <Instance key={i} rotation-x={-0.56} position={[0, (i + 0.5) * pitch - height / 2, pitch * 0.22]} />
            ))}
        </Instances>
    </group>;
}
