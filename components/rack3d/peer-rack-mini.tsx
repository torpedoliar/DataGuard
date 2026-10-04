"use client";

import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { RackDevice } from "@/actions/rack-layout";
import { RACK_D, RACK_W, U, rackHeight, uToY } from "./constants";
import { inRack } from "./free-slots";

// A demand-driven canvas has no controls, so the camera is aimed once. The rack
// is drawn in metres and scaled down to a unit cube, which keeps the geometry
// identical to the main scene without touching it.
function LookAtCentre() {
    const camera = useThree((s) => s.camera);
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        camera.lookAt(0, 0, 0);
        invalidate();
    }, [camera, invalidate]);
    return null;
}

// Peer rack in miniature, for the other-room card: a plain chassis plus one
// slab per device with the peer picked out. Deliberately its own <Canvas> —
// no composer, no Html, no shared LED materials — so it cannot perturb the main
// scene's framing or fade state.
export default function PeerRackMini({ devices, totalU, peerId }: { devices: RackDevice[]; totalU: number; peerId: number }) {
    const H = rackHeight(totalU);
    const scale = 1 / Math.max(H, 1);
    return (
        <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0.85, 0.2, 1.15], fov: 34, near: 0.01, far: 20 }} gl={{ antialias: true }}>
            <ambientLight intensity={1.5} />
            <directionalLight position={[1.5, 2, 2]} intensity={1.8} />
            <LookAtCentre />
            <group scale={scale} position={[0, -0.5, 0]}>
                <mesh position={[0, H / 2, 0]}>
                    <boxGeometry args={[RACK_W, H, RACK_D]} />
                    <meshStandardMaterial color="#16181c" metalness={0.45} roughness={0.5} />
                </mesh>
                {devices.filter((d) => inRack(d, totalU)).map((d) => {
                    const uh = d.uHeight || 1;
                    const y = uToY(d.rackPosition ?? 1) + (uh * U) / 2;
                    const isPeer = d.id === peerId;
                    return (
                        <mesh key={d.id} position={[0, y, RACK_D / 2 + 0.004]}>
                            <boxGeometry args={[RACK_W * 0.9, uh * U - 0.002, 0.004]} />
                            <meshStandardMaterial
                                color={isPeer ? "#5eead4" : d.categoryColor || "#64748b"}
                                emissive={isPeer ? "#5eead4" : "#000000"}
                                emissiveIntensity={isPeer ? 0.7 : 0}
                                metalness={0.3}
                                roughness={0.4}
                            />
                        </mesh>
                    );
                })}
            </group>
        </Canvas>
    );
}
