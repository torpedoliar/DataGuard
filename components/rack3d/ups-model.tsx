"use client";

import type { PacModelProps } from "./pac-model";
export function ApcUpsModel({ width: w, depth: d, height: h, opacity, detailed }: PacModelProps) {
    const material = { color: "#292e32", roughness: 0.52, metalness: 0.3, transparent: opacity < 1, opacity, userData: { ownFade: true } };
    return <group>
        <mesh position={[0, h * 0.008, -0.008]}><boxGeometry args={[w, h * 0.984, d - 0.016]} /><meshStandardMaterial {...material} /></mesh>
        <mesh position={[0, 0, d / 2 - 0.01]}><boxGeometry args={[w * 0.89, h * 0.92, 0.012]} /><meshStandardMaterial {...material} color="#101519" /></mesh>
        {Array.from({ length: detailed ? 32 : 22 }, (_, i) => <mesh key={i} position={[w * (-0.39 + i * 0.78 / ((detailed ? 32 : 22) - 1)), -h * 0.015, d / 2 - 0.003]}><boxGeometry args={[0.006, h * 0.82, 0.006]} /><meshStandardMaterial {...material} color="#687077" /></mesh>)}
        <mesh position={[0, h * 0.44, d / 2 - 0.005]}><boxGeometry args={[w * 0.83, h * 0.058, 0.01]} /><meshStandardMaterial {...material} color="#404a53" /></mesh>
        <mesh position={[-w * 0.045, h * 0.44, d / 2 - 0.0007]}><boxGeometry args={[w * 0.35, h * 0.028, 0.001]} /><meshStandardMaterial {...material} color="#a4b9b2" /></mesh>
        {[0, 1, 2].map((i) => <mesh key={i} position={[w * 0.27, h * (0.425 + i * 0.014), d / 2 - 0.001]}><boxGeometry args={[w * 0.044, h * 0.009, 0.002]} /><meshStandardMaterial {...material} color="#b0b7ba" /></mesh>)}
        <mesh position={[0, h * 0.15, d / 2 - 0.0007]}><boxGeometry args={[w * 0.13, h * 0.032, 0.001]} /><meshStandardMaterial {...material} color="#95515b" /></mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * w * 0.37, -h / 2 + 0.01, d * 0.35]}><boxGeometry args={[0.032, 0.02, 0.04]} /><meshStandardMaterial {...material} color="#111619" /></mesh>)}
    </group>;
}
