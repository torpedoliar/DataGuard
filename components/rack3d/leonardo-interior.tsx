"use client";

import { useMemo } from "react";
import { CatmullRomCurve3, Vector3 } from "three";

function Block({ p, s, color }: { p: [number, number, number]; s: [number, number, number]; color: string }) {
    return <mesh position={p}><boxGeometry args={s} /><meshStandardMaterial color={color} metalness={0.35} roughness={0.6} /></mesh>;
}
function Pipe({ points, radius, color }: { points: [number, number, number][]; radius: number; color: string }) {
    const curve = useMemo(() => new CatmullRomCurve3(points.map((p) => new Vector3(...p))), [points]);
    return <mesh><tubeGeometry args={[curve, 20, radius, 6, false]} /><meshStandardMaterial color={color} metalness={0.65} roughness={0.4} /></mesh>;
}
export default function LeonardoInterior({ width: w, height: h, depth: d }: { width: number; height: number; depth: number }) {
    return <group>
        <Block p={[0, h * 0.285, -d * 0.2]} s={[w * 0.9, h * 0.32, 0.018]} color="#909b9f" />
        {/* Upper electrical assembly: illustrative arrangement from the photo. */}
        {[-0.12, 0.12].map((y) => <Block key={y} p={[0, h * (0.29 + y), -d * 0.13]} s={[w * 0.86, 0.012, 0.025]} color="#c7cdd0" />)}
        {Array.from({ length: 6 }, (_, i) => <Block key={i} p={[w * (-0.33 + i * 0.115), h * 0.28, 0]} s={[w * 0.078, h * 0.075, d * 0.16]} color={i % 2 ? "#dddcd3" : "#b6bdbb"} />)}
        <Block p={[-w * 0.23, h * 0.38, -d * 0.03]} s={[w * 0.36, h * 0.038, d * 0.11]} color="#d7d9d0" />
        <Block p={[w * 0.32, h * 0.37, -d * 0.02]} s={[w * 0.14, h * 0.065, d * 0.12]} color="#34383d" />
        <Block p={[0, h * 0.18, d * 0.025]} s={[w * 0.82, 0.018, 0.018]} color="#aa9e32" />
        <mesh position={[w * 0.19, h * 0.28, d * 0.12]}><boxGeometry args={[w * 0.5, h * 0.21, 0.002]} /><meshPhysicalMaterial color="#d4e4ea" transparent opacity={0.16} roughness={0.25} depthWrite={false} /></mesh>
        {/* Coil bank, bounded fins rather than one mesh per real fin. */}
        <Block p={[0, -h * 0.035, -d * 0.13]} s={[w * 0.86, h * 0.32, d * 0.32]} color="#343e42" />
        {Array.from({ length: 24 }, (_, i) => <Block key={i} p={[w * (-0.41 + i * 0.035), -h * 0.035, d * 0.045]} s={[w * 0.012, h * 0.31, 0.012]} color="#848d90" />)}
        {[{ x: 0.16, color: "#174a8c", radius: 0.105, height: 0.22 }, { x: -0.27, color: "#b2b8ad", radius: 0.075, height: 0.18 }].map((part) => <mesh key={part.x} position={[w * part.x, -h * 0.33, -d * 0.01]}><cylinderGeometry args={[w * part.radius, w * part.radius, h * part.height, 24]} /><meshStandardMaterial color={part.color} metalness={0.4} roughness={0.42} /></mesh>)}
        <Pipe radius={0.012} color="#a46b38" points={[[w * 0.16, -h * 0.23, 0], [w * 0.32, -h * 0.22, 0], [w * 0.34, -h * 0.35, 0], [w * 0.04, -h * 0.4, 0]]} />
        <Pipe radius={0.018} color="#252a2d" points={[[-w * 0.28, -h * 0.24, 0], [-w * 0.39, -h * 0.19, 0], [-w * 0.4, h * 0.1, -d * 0.1]]} />
        {["#b93932", "#d7c34d", "#3c7650", "#3f5881"].map((color, i) => <Pipe key={color} radius={0.0025} color={color} points={[[w * (-0.3 + i * 0.15), h * 0.36, d * 0.08], [w * (-0.2 + i * 0.12), h * 0.22, d * 0.09], [w * (-0.32 + i * 0.16), h * 0.18, d * 0.08]]} />)}
        <Block p={[0, 0, d * 0.2]} s={[w * 0.045, h * 0.95, 0.02]} color="#d9dad4" />
    </group>;
}
