"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Shape, type Group } from "three";
import { fanRotation } from "./fan-motion";
import { hardwareTexture } from "./textures";
import { HousingGrille } from "./housing-grille";
import LeonardoInterior from "./leonardo-interior";

export interface PacModelProps { width: number; depth: number; height: number; opacity: number; detailed: boolean; animateFans?: boolean; cabinetOpen?: boolean }

function ControllerMaterial({ opacity }: { opacity: number }) {
    return <meshStandardMaterial map={hardwareTexture("controller")} roughness={0.35} transparent={opacity < 1} opacity={opacity} />;
}

function Panel({ position, size, color, opacity }: { position: [number, number, number]; size: [number, number, number]; color: string; opacity: number }) {
    return <mesh position={position} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.55} metalness={0.25} transparent={opacity < 1} opacity={opacity} userData={{ ownFade: true }} /></mesh>;
}

export function LeonardoModel({ width: w, depth: d, height: h, opacity, detailed, cabinetOpen = false }: PacModelProps) {
    const face = d / 2;
    return <group>
        <Panel position={[0, 0, -d / 2 + 0.006]} size={[w, h * 0.96, 0.012]} color="#d6d7d3" opacity={opacity} />
        {[-1, 1].map((side) => <Panel key={side} position={[side * (w / 2 - 0.006), 0, 0]} size={[0.012, h * 0.96, d]} color="#d6d7d3" opacity={opacity} />)}
        <Panel position={[0, h / 2 - 0.025, 0]} size={[w, 0.012, d]} color="#d6d7d3" opacity={opacity} />
        <mesh position={[0, h / 2 - 0.018, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[w * 0.91, d * 0.87]} />
            <meshStandardMaterial color="#88928e" roughness={0.45} transparent={opacity < 1} opacity={opacity} />
            <group position-z={0.001}>
                <HousingGrille width={w * 0.88} height={d * 0.84} count={16} opacity={opacity} color="#9ba7a5" />
            </group>
        </mesh>
        {cabinetOpen && <LeonardoInterior width={w} height={h} depth={d} />}
        <group position={[-w / 2, 0, face - 0.018]} rotation-y={cabinetOpen ? -1.9 : 0}>
            <Panel position={[w * 0.24, 0, 0]} size={[w * 0.475, h * 0.965, 0.012]} color="#d6d7d3" opacity={opacity} />
            <Panel position={[w * 0.415, -h * 0.008, 0.008]} size={[w * 0.038, h * 0.116, 0.012]} color="#475251" opacity={opacity} />
            <Panel position={[w * 0.415, -h * 0.008, 0.014]} size={[w * 0.014, h * 0.09, 0.005]} color="#88948f" opacity={opacity} />
            <Panel position={[w * 0.19, h * 0.445, 0.007]} size={[w * 0.2, h * 0.024, 0.002]} color="#498351" opacity={opacity} />
        </group>
        <group position={[w / 2, 0, face - 0.018]} rotation-y={cabinetOpen ? 1.9 : 0}>
            <Panel position={[-w * 0.25, 0, 0]} size={[w * 0.49, h * 0.965, 0.012]} color="#d6d7d3" opacity={opacity} />
            <group position={[-w / 2, 0, -face + 0.018]}>
        <Panel position={[-w * 0.018, h * 0.013, face - 0.004]} size={[0.004, h * 0.96, 0.006]} color="#707572" opacity={opacity} />
        <Panel position={[w * 0.032, h * 0.013, face - 0.004]} size={[0.003, h * 0.96, 0.006]} color="#929792" opacity={opacity} />
        <Panel position={[w * 0.275, h * 0.335, face - 0.010]} size={[w * 0.31, h * 0.3, 0.01]} color="#a6aaa4" opacity={opacity} />
        <Panel position={[w * 0.255, h * 0.265, face - 0.004]} size={[w * 0.23, h * 0.059, 0.004]} color="#39734b" opacity={opacity} />
        <Panel position={[w * 0.255, h * 0.265, face - 0.001]} size={[w * 0.16, h * 0.038, 0.001]} color="#727d72" opacity={opacity} />
        {[0, 1, 2].map((button) => <Panel key={`lcd-button-${button}`} position={[w * 0.345, h * (0.252 + button * 0.012), face - 0.0007]} size={[w * 0.025, h * 0.008, 0.001]} color="#424b43" opacity={opacity} />)}
        <Panel position={[w * 0.09, h * 0.1, face - 0.001]} size={[w * 0.068, h * 0.014, 0.002]} color="#208842" opacity={opacity} />
        {detailed && <>
            <Panel position={[w * 0.1, h * 0.4, face - 0.008]} size={[w * 0.095, h * 0.026, 0.016]} color="#242b29" opacity={opacity} />
            <Panel position={[w * 0.105, h * 0.4, face - 0.001]} size={[w * 0.06, h * 0.008, 0.002]} color="#923d36" opacity={opacity} />
        </>}
            </group>
        </group>
        <Panel position={[0, -h / 2 + h * 0.017, 0]} size={[w, h * 0.034, d]} color="#424a4b" opacity={opacity} />
    </group>;
}

// Seven swept blades share an extruded silhouette and rotate as a single mesh.
const blades = Array.from({ length: 7 }, (_, i) => {
    const angle = i * Math.PI * 2 / 7;
    const rotate = (x: number, y: number): [number, number] => [
        x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle),
    ];
    const blade = new Shape();
    blade.moveTo(...rotate(0.21, -0.12));
    blade.bezierCurveTo(...rotate(0.47, -0.27), ...rotate(0.84, -0.23), ...rotate(0.94, 0.08));
    blade.quadraticCurveTo(...rotate(0.89, 0.29), ...rotate(0.75, 0.38));
    blade.quadraticCurveTo(...rotate(0.55, 0.13), ...rotate(0.22, 0.13));
    blade.closePath();
    return blade;
});

function FanGuard({ radius, opacity }: { radius: number; opacity: number }) {
    return <mesh position-z={0.009}>
        <planeGeometry args={[radius * 2.06, radius * 2.06]} />
        <meshStandardMaterial map={hardwareTexture("guard")} alphaTest={0.25} color="#a0aaad" metalness={0.58} roughness={0.38} transparent={opacity < 1} opacity={opacity} />
    </mesh>;
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
    return <group ref={rotor}>
        <mesh scale={[radius, radius, radius]} position-z={0.003}>
            <extrudeGeometry args={[blades, { depth: 0.018, bevelEnabled: false, curveSegments: 6 }]} />
            <meshStandardMaterial color="#637079" metalness={0.41} roughness={0.42} transparent={opacity < 1} opacity={opacity} />
        </mesh>
    </group>;
}

export function InRowModel({ width: w, depth: d, height: h, opacity, detailed, animateFans = false }: PacModelProps) {
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
                <mesh position={[0, 0, 0.006]} rotation-x={Math.PI / 2}><cylinderGeometry args={[radius * 0.34, radius * 0.34, 0.004, 16]} /><meshStandardMaterial color="#737b80" roughness={0.7} transparent={opacity < 1} opacity={opacity} /></mesh>
                <FanRotor radius={radius} opacity={opacity} animate={animateFans} />
                {detailed && <FanGuard radius={radius} opacity={opacity} />}
            </group>;
        })}

        <Panel position={[0, h * 0.29, front - 0.009]} size={[w * 0.86, h * 0.063, 0.012]} color="#737e88" opacity={opacity} />
        <mesh position={[w * 0.04, h * 0.29, front - 0.001]}>
            <planeGeometry args={[w * 0.56, h * 0.04]} />
            <ControllerMaterial opacity={opacity} />
        </mesh>
        <Panel position={[-w * 0.28, h * 0.474, front - 0.001]} size={[w * 0.27, h * 0.012, 0.002]} color="#517b50" opacity={opacity} />
        {[-1, 1].map((side) => <Panel key={side} position={[side * (w / 2 - 0.006), 0, front - 0.006]} size={[0.012, h * 0.96, 0.012]} color="#93999b" opacity={opacity} />)}
        {detailed && [-1, 1].map((side) => <Panel key={side} position={[side * (w / 2 - 0.001), -h * 0.18, 0]} size={[0.002, 0.003, d * 0.97]} color="#1a2023" opacity={opacity} />)}
    </group>;
}
