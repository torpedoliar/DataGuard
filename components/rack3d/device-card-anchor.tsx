"use client";

import { Html } from "@react-three/drei";
import type { RackDevice } from "@/actions/rack-layout";
import { useDeviceDrawer } from "@/components/admin/device-drawer-sections";
import { FRONT_Z, SLIDE, U, uToY } from "./constants";
import { DeviceCard3DContent } from "./device-card-3d";

interface DeviceCardAnchorProps {
    device: RackDevice;
    onClose: () => void;
    onSelectPeer?: (deviceId: number) => void;
}

// Height of the anchor above the rack base: device centre + half height +
// clearance. Exported for the unit test; the clearance keeps the card clear
// of the chassis even when the device slides out on its rails (SLIDE).
export const CARD_CLEARANCE = 0.16;

export function cardAnchorPosition(rackPosition: number, uHeight: number): number {
    const uh = uHeight || 1;
    return uToY(rackPosition ?? 1) + uh * U + CARD_CLEARANCE;
}

// <Html> card floating above the device in the 3D scene. Rendered from the
// selected RackDevice (no placed-layout lookup), so the card shows wherever
// the device itself renders — including filtered or cross-room selections.
export function DeviceCardAnchor({ device, onClose, onSelectPeer }: DeviceCardAnchorProps) {
    const drawer = useDeviceDrawer(device.id);
    const uh = device.uHeight || 1;
    return (
        <Html
            position={[0, cardAnchorPosition(device.rackPosition ?? 1, uh), FRONT_Z + SLIDE + 0.05]}
            center
            distanceFactor={2.2}
            zIndexRange={[60, 0]}
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
