"use client";

import { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import type { SceneRack } from "@/lib/rack-filter";
import { peerRackFraming } from "./constants";
import { RackCabinet } from "./rack-cabinet";

function AimCentre({ minDistance }: { minDistance: number }) {
    const ref = useRef<CameraControls>(null);
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        const controls = ref.current;
        if (!controls) return;
        controls.setLookAt(controls.camera.position.x, controls.camera.position.y, controls.camera.position.z, 0, 0, 0, false);
        invalidate();
    }, [invalidate]);
    return <CameraControls ref={ref} makeDefault minDistance={minDistance} maxDistance={4} />;
}

// Separate canvas, same cabinet and device geometry as the room. Filters in the
// source room must not hide devices in the destination preview.
export default function PeerRackMini({ rack, peerId }: { rack: SceneRack; peerId: number }) {
    const totalU = rack.totalU || 42;
    const { scale, offsetY, camera, fov, minDistance } = peerRackFraming(totalU);
    const previewRack = { ...rack, dimmed: false, devices: rack.devices.map((d) => ({ ...d, isMuted: false })) };
    return (
        <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: camera, fov, near: 0.01, far: 20 }} gl={{ antialias: true }}>
            <ambientLight intensity={1.5} />
            <hemisphereLight args={["#ffffff", "#64748b", 1.5]} />
            <directionalLight position={[1.5, 2, 2]} intensity={1.8} />
            <AimCentre minDistance={minDistance} />
            <group scale={scale} position={[0, offsetY, 0]}>
                <RackCabinet
                    placed={{ rack: previewRack, x: 0, z: 0, rotationY: 0, row: "", slot: 1, collision: false, unplaced: false }}
                    dark={false}
                    focused
                    faded={false}
                    showFree={false}
                    accent="#5eead4"
                    colorBy="category"
                    selectedDeviceId={peerId}
                    peerDeviceId={null}
                    onFocus={() => {}}
                    onSelectDevice={() => {}}
                />
            </group>
        </Canvas>
    );
}
