import { buildFaceplate, isFaceplateConfigured } from "@/lib/faceplate";

export interface PortFacePort {
    id: number;
    portName: string;
    portIndex: number | null;
    mediaType: string | null;
    status: string | null;
}

export interface PortFaceInput {
    faceplatePortCount: number | null;
    faceplateUplinkCount: number | null;
    faceplateRows: number | null;
    faceplateNumbering: string | null;
    ports: PortFacePort[];
}

export type PortState = "active" | "inactive" | "down" | "empty";

export interface PortFaceSlot {
    x: number;
    y: number;
    w: number;
    h: number;
    uplink: boolean;
    state: PortState;
    // Which of the shared blink materials drives this port's LED (0..2), so a
    // switch flickers port by port instead of all at once.
    phase: number;
}

// Port area on the 19" face: right of the name tag + brand logo (which end
// near x = -0.02), left of the status LED (x = 0.208).
const X0 = -0.01;
const X1 = 0.195;
const FILL_H = 0.55; // share of device height the port block may use

const stateOf = (status: string | null | undefined): PortState =>
    status === "Active" ? "active" : status === "Down" ? "down" : "inactive";

// The documented faceplate (same slots as the 2D/PDF faceplate), scaled to
// metres and centred on the device face. Null when the device has no
// faceplate configured, so the caller keeps its generic face.
export function portFace(device: PortFaceInput, deviceHeight: number): { slots: PortFaceSlot[] } | null {
    const config = {
        portCount: device.faceplatePortCount,
        uplinkCount: device.faceplateUplinkCount,
        rows: device.faceplateRows,
        numbering: device.faceplateNumbering,
    };
    if (!isFaceplateConfigured(config)) return null;

    const plate = buildFaceplate(config, device.ports);
    if (!plate.slots.length) return null;
    const minX = Math.min(...plate.slots.map((s) => s.x));
    const maxX = Math.max(...plate.slots.map((s) => s.x + s.width));
    const minY = Math.min(...plate.slots.map((s) => s.y));
    const maxY = Math.max(...plate.slots.map((s) => s.y + s.height));
    const scale = Math.min((X1 - X0) / (maxX - minX), (deviceHeight * FILL_H) / (maxY - minY));
    const cx = (minX + maxX) / 2 - ((X0 + X1) / 2) / scale;
    const cy = (minY + maxY) / 2;

    return {
        slots: plate.slots.map((s) => ({
            x: (s.x + s.width / 2 - cx) * scale,
            y: -(s.y + s.height / 2 - cy) * scale, // SVG y grows down
            w: s.width * scale * 0.86,
            h: s.height * scale * 0.82,
            uplink: s.block === "uplink",
            state: s.port ? stateOf((s.port as PortFacePort).status) : "empty",
            phase: (s.slotNumber * 7 + (s.slotNumber >> 2)) % 3,
        })),
    };
}
