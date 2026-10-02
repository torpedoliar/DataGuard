"use client";

import { Html } from "@react-three/drei";
import type { RackDevice } from "@/actions/rack-layout";
import type { SceneRack } from "@/lib/rack-filter";
import { useDeviceDrawer } from "@/components/admin/device-drawer-sections";
import { FRONT_Z, U, uToY } from "./constants";
import type { PlacedRack } from "./layout";
import { DeviceCard3DContent } from "./device-card-3d";

interface DeviceCardAnchorProps {
    placed: PlacedRack<SceneRack>[];
    device: RackDevice;
    onClose: () => void;
    onSelectPeer?: (deviceId: number) => void;
}

// <Html> card floating above the selected device, inside the Canvas so it
// tracks the device while orbiting. Occluded by racks in front; hides with
// the row filter like everything else in the focused row.
export function DeviceCardAnchor({ placed, device, onClose, onSelectPeer }: DeviceCardAnchorProps) {
    const drawer = useDeviceDrawer(device.id);
    const uh = device.uHeight || 1;
    for (const p of placed) {
        if (!p.rack.devices.some((d) => d.id === device.id)) continue;
        const y = uToY(device.rackPosition ?? 1) + (uh * U) / 2;
        return (
            <group position={[p.x, 0, p.z]} rotation-y={p.rotationY}>
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
                    />
                </Html>
            </group>
        );
    }
    return null;
}
