"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";
import { fanRotation } from "./fan-motion";
import { repeated, perforationTexture } from "./textures";

export interface PacModelProps { width: number; depth: number; height: number; opacity: number; detailed: boolean; animateFans?: boolean }

function Panel({ position, size, color, opacity }: { position: [number, number, number]; size: [number, number, number]; color: string; opacity: number }) {
    return <mesh position={position} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.55} metalness={0.25} transparent={opacity < 1} opacity={opacity} userData={{ ownFade: true }} /></mesh>;
}

export function LeonardoModel({ width: w, depth: d, height: h, opacity, detailed }: PacModelProps) {
    const face = d / 2;
    return <group>
        <Panel position={[0, 0, -0.01]} size={[w, h, d - 0.02]} color="#d6d7d3" opacity={opacity} />
        <Panel position={[0, -h / 2 + h * 0.017, 0]} size={[w, h * 0.034, d]} color="#424a4b" opacity={opacity} />
        <Panel position={[-w * 0.018, h * 0.013, face - 0.004]} size={[0.004, h * 0.96, 0.006]} color="#707572" opacity={opacity} />
        <Panel position={[w * 0.032, h * 0.013, face - 0.004]} size={[0.003, h * 0.96, 0.006]} color="#929792" opacity={opacity} />
        <Panel position={[w * 0.275, h * 0.335, face - 0.006]} size={[w * 0.31, h * 0.3, 0.01]} color="#a6aaa4" opacity={opacity} />
        <Panel position={[w * 0.255, h * 0.265, face - 0.002]} size={[w * 0.23, h * 0.059, 0.004]} color="#39734b" opacity={opacity} />
        <Panel position={[w * 0.255, h * 0.265, face - 0.0005]} size={[w * 0.205, h * 0.047, 0.001]} color="#cad5cb" opacity={opacity} />
        <Panel position={[w * 0.09, h * 0.1, face - 0.001]} size={[w * 0.068, h * 0.014, 0.002]} color="#208842" opacity={opacity} />
        <Panel position={[-w * 0.31, h * 0.445, face - 0.001]} size={[w * 0.2, h * 0.024, 0.002]} color="#498351" opacity={opacity} />
        {detailed && <>
            <Panel position={[w * 0.1, h * 0.4, face - 0.008]} size={[w * 0.095, h * 0.026, 0.016]} color="#242b29" opacity={opacity} />
            <Panel position={[w * 0.105, h * 0.4, face - 0.001]} size={[w * 0.06, h * 0.008, 0.002]} color="#923d36" opacity={opacity} />
            {[0, 1, 2, 3].map((i) => <Panel key={i} position={[w * 0.255, h * (0.25 + i * 0.008), face - 0.0001]} size={[w * 0.15, 0.001, 0.0002]} color="#7b8880" opacity={opacity} />)}
        </>}
    </group>;
}

function FanRotor({ radius, opacity, animate }: { radius: number; opacity: number; animate: boolean }) {
    const rotor = useRef<Group>(null);
    const invalidate = useThree((state) => state.invalidate);
    const reduced = useRef(false);
    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => { reduced.current = media.matches; if (animate && !document.hidden && !media.matches) invalidate(); };
        update();
        media.addEventListener("change", update);
        document.addEventListener("visibilitychange", update);
        return () => { media.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
    }, [animate, invalidate]);
    useFrame((_, delta) => {
        if (!rotor.current) return;
        const next = fanRotation(rotor.current.rotation.z, delta, animate, document.hidden, reduced.current);
        if (next !== rotor.current.rotation.z) { rotor.current.rotation.z = next; invalidate(); }
    });
    return <group ref={rotor}>{Array.from({ length: 7 }, (_, blade) => <group key={blade} rotation-z={blade * Math.PI * 2 / 7}><Panel position={[radius * 0.48, 0, 0.002]} size={[radius * 0.64, radius * 0.23, 0.003]} color="#3c444b" opacity={opacity} /></group>)}</group>;
}

export function InRowModel({ width: w, depth: d, height: h, opacity, detailed, animateFans = false }: PacModelProps) {
    const grille = useMemo(() => repeated(perforationTexture(), w / 0.012, h / 0.012), [w, h]);
    useEffect(() => () => grille.dispose(), [grille]);
    const front = d / 2;
    const radius = w * 0.395;
    return <group>
        <Panel position={[0, h * 0.013, -0.015]} size={[w, h * 0.974, d - 0.03]} color="#34393b" opacity={opacity} />
        <Panel position={[0, -h / 2 + h * 0.013, 0]} size={[w * 0.88, h * 0.026, d * 0.95]} color="#191d20" opacity={opacity} />
        <Panel position={[0, 0, front - 0.021]} size={[w * 0.9, h * 0.94, 0.012]} color="#111619" opacity={opacity} />
        {Array.from({ length: 8 }, (_, i) => {
            const y = h * 0.405 - i * h * 0.116;
            return <group key={i} position={[0, y, front - 0.012]}>
                <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[radius, radius, 0.006, 24]} /><meshStandardMaterial color="#151b20" roughness={0.8} transparent={opacity < 1} opacity={opacity} /></mesh>
                <mesh position={[0, 0, 0.003]} rotation-x={Math.PI / 2}><cylinderGeometry args={[radius * 0.34, radius * 0.34, 0.004, 16]} /><meshStandardMaterial color="#737b80" roughness={0.7} transparent={opacity < 1} opacity={opacity} /></mesh>
                {(detailed || animateFans) && <FanRotor radius={radius} opacity={opacity} animate={animateFans} />}
            </group>;
        })}
        <mesh position={[0, 0, front - 0.002]}><planeGeometry args={[w * 0.91, h * 0.94]} /><meshStandardMaterial color="#81878b" alphaMap={grille} alphaTest={0.5} roughness={0.7} metalness={0.45} transparent={opacity < 1} opacity={opacity} /></mesh>
        <Panel position={[0, h * 0.29, front - 0.006]} size={[w * 0.86, h * 0.063, 0.012]} color="#737e88" opacity={opacity} />
        <Panel position={[w * 0.04, h * 0.29, front - 0.0015]} size={[w * 0.56, h * 0.04, 0.003]} color="#c1cece" opacity={opacity} />
        <Panel position={[-w * 0.28, h * 0.474, front - 0.001]} size={[w * 0.27, h * 0.012, 0.002]} color="#517b50" opacity={opacity} />
        {[-1, 1].map((side) => <Panel key={side} position={[side * (w / 2 - 0.006), 0, front - 0.006]} size={[0.012, h * 0.96, 0.012]} color="#93999b" opacity={opacity} />)}
        {detailed && [-1, 1].map((side) => <Panel key={side} position={[side * (w / 2 - 0.001), -h * 0.18, 0]} size={[0.002, 0.003, d * 0.97]} color="#1a2023" opacity={opacity} />)}
    </group>;
}
