"use client";

import { Html } from "@react-three/drei";
import type { RackDevice } from "@/actions/rack-layout";
import { useDeviceDrawer } from "@/components/admin/device-drawer-sections";
import { FRONT_Z, U, uToY } from "./constants";
import { DeviceCard3DContent } from "./device-card-3d";

interface DeviceCardAnchorProps {
    device: RackDevice;
    onClose: () => void;
    onSelectPeer?: (deviceId: number) => void;
}

// <Html> card floating above the device in the 3D scene. Rendered from the
// selected RackDevice (no placed-layout lookup), so the card shows wherever
// the device itself renders — including filtered or cross-room selections.
export function DeviceCardAnchor({ device, onClose, onSelectPeer }: DeviceCardAnchorProps) {
    const drawer = useDeviceDrawer(device.id);
    const uh = device.uHeight || 1;
    const y = uToY(device.rackPosition ?? 1) + (uh * U) / 2;
    return (
        <Html
            position={[0, y + (uh * U) / 2 + 0.12, FRONT_Z]}
            center
            distanceFactor={2.2}
            occlude="raycast"
            zIndexRange={[50, 0]}
        >
            <DeviceCard3DContent
                device={device}
                drawer={drawer.data}
                loading={drawer.loading}
                onClose={onClose}
                onSelectPeer={onSelectPeer}
                photoPath={device.photoPath}
            />
        </Html>
    );
}
