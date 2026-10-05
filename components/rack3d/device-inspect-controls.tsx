"use client";

import { CameraControls } from "@react-three/drei";

export default function DeviceInspectControls() {
    return <CameraControls makeDefault minDistance={0.45} maxDistance={3} />;
}
