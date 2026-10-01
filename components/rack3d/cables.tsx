"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { CableInfo, Vec3 } from "./cable-route";

// Polyline with small rounded bends, so tubes don't kink at the corners.
function rounded(points: Vec3[], radius = 0.025) {
    const v = points.map((p) => new THREE.Vector3(...p));
    const path = new THREE.CurvePath<THREE.Vector3>();
    let from = v[0];
    for (let i = 1; i < v.length - 1; i++) {
        const inDir = v[i].clone().sub(v[i - 1]);
        const outDir = v[i + 1].clone().sub(v[i]);
        const k = Math.min(radius, inDir.length() / 2, outDir.length() / 2);
        const p0 = v[i].clone().sub(inDir.normalize().multiplyScalar(k));
        const p1 = v[i].clone().add(outDir.normalize().multiplyScalar(k));
        path.add(new THREE.LineCurve3(from, p0));
        path.add(new THREE.QuadraticBezierCurve3(p0, v[i], p1));
        from = p1;
    }
    path.add(new THREE.LineCurve3(from, v[v.length - 1]));
    return path;
}

// At most one device's ports (<= ~52 tubes): plain meshes, no instancing.
export function Cables({ cables }: { cables: CableInfo[] }) {
    const geos = useMemo(
        () => cables.map((c) => new THREE.TubeGeometry(rounded(c.points), Math.max(24, c.points.length * 12), 0.005, 6, false)),
        [cables],
    );
    useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);

    return (
        <>
            {cables.map((c, i) => (
                <group key={c.key}>
                    <mesh geometry={geos[i]}>
                        <meshStandardMaterial color={c.color} emissive={c.color} emissiveIntensity={0.35} roughness={0.5} />
                    </mesh>
                    {c.label && (
                        <Html position={c.points[c.points.length - 1]} center pointerEvents="none" zIndexRange={[30, 0]}>
                            <div className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">{c.label}</div>
                        </Html>
                    )}
                </group>
            ))}
        </>
    );
}
