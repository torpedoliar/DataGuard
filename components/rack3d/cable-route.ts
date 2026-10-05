import type { SceneRack } from "@/lib/rack-filter";
import { FRONT_Z, RACK_W, SLIDE, U, rackHeight, uToY } from "./constants";
import { deviceKind } from "./device-kind";
import { inRack } from "./free-slots";
import type { PlacedRack } from "./layout";
import { portFace, type PortFaceSlot } from "./port-face";

export type Vec3 = [number, number, number];

// A cable end in world space: the port, which way the rack front faces (+z
// or -z), the rack's row line (its tray) and its roof height.
export interface Anchor {
    pos: Vec3;
    facing: 1 | -1;
    rowZ: number;
    rackTop: number;
}

interface RackPlacement { x: number; z: number; rotationY: number; rackTop: number }

const OUT = 0.06;    // straight out of the port before the first bend
const LANE = 0.012;  // spacing between parallel cables

export function portAnchor(
    rack: RackPlacement,
    device: { rackPosition: number | null; uHeight: number | null },
    slot: Pick<PortFaceSlot, "x" | "y"> | null,
    slide = 0,
): Anchor {
    const dir: 1 | -1 = rack.rotationY === 0 ? 1 : -1; // back-facing racks are turned 180°
    const uh = device.uHeight || 1;
    const y = uToY(device.rackPosition ?? 1) + (uh * U) / 2 + (slot?.y ?? 0);
    const lz = FRONT_Z + 0.004 + slide;
    return { pos: [rack.x + dir * (slot?.x ?? 0), y, rack.z + dir * lz], facing: dir, rowZ: rack.z, rackTop: rack.rackTop };
}

const dedupe = (pts: Vec3[]) =>
    pts.filter((p, i) => i === 0 || p.some((v, k) => Math.abs(v - pts[i - 1][k]) > 1e-9));

// Right-angle route like real cabling: out of the port, up to the tray over
// the row, along it (via the row end when changing rows), down the peer's
// front, into its port. Same-rack links loop in front of the rack; a peer
// outside this room ends just above the rack.
export function routeCable(a: Anchor, b: Anchor | null, opts: { trayY: number; aisleX: number; lane: number; sameRack: boolean }): Vec3[] {
    const off = opts.lane * LANE;
    const front = (e: Anchor): Vec3 => [e.pos[0], e.pos[1], e.pos[2] + e.facing * (OUT + off)];
    const a1 = front(a);
    if (!b) return dedupe([a.pos, a1, [a1[0], a.rackTop + 0.15 + off, a1[2]]]);
    if (opts.sameRack) {
        return dedupe([a.pos, a1, [a1[0], b.pos[1], a1[2]], [b.pos[0], b.pos[1], a1[2]], b.pos]);
    }
    const b1 = front(b);
    const ty = opts.trayY + off;
    const pts: Vec3[] = [a.pos, a1, [a1[0], ty, a1[2]], [a1[0], ty, a.rowZ]];
    if (Math.abs(a.rowZ - b.rowZ) > 1e-6) {
        pts.push([opts.aisleX + off, ty, a.rowZ], [opts.aisleX + off, ty, b.rowZ]);
    }
    pts.push([b1[0], ty, b.rowZ], [b1[0], ty, b1[2]], b1, b.pos);
    return dedupe(pts);
}

export type CableKind = "access" | "trunk" | "uplink";
export const CABLE_COLOR: Record<CableKind, string> = { access: "#3b82f6", trunk: "#f97316", uplink: "#a855f7" };

// Uplink: an uplink (SFP) slot, or switch to switch. Otherwise the port mode.
export function cableKind(portMode: string | null, uplinkSlot: boolean, peerIsNetwork: boolean, selfIsNetwork: boolean): CableKind {
    if (uplinkSlot || (selfIsNetwork && peerIsNetwork)) return "uplink";
    return portMode === "Trunk" ? "trunk" : "access";
}

export interface CableInfo {
    key: string;
    points: Vec3[];
    color: string;
    label: string | null;
}

// Cables of every watched device to its documented peers, plus the racks those
// peers sit in (the scene keeps them visible and un-faded). More than one
// device is watched at a time because a same-room peer gets its own hologram,
// and a focused row must keep the peer's rack on screen.
export function buildCables(placed: PlacedRack<SceneRack>[], watchedDeviceIds: (number | null)[], selectedDeviceId: number | null = watchedDeviceIds[0] ?? null, slide = SLIDE, slides?: ReadonlyMap<number, number>): { cables: CableInfo[]; peerRacks: Set<string> } {
    const peerRacks = new Set<string>();
    const ids = watchedDeviceIds.filter((id): id is number => id != null);
    if (ids.length === 0 || placed.length === 0) return { cables: [], peerRacks };

    type Where = { p: PlacedRack<SceneRack>; d: SceneRack["devices"][number] };
    const where = new Map<number, Where>();
    const invalid = new Set<number>();
    for (const p of placed) for (const d of p.rack.devices) {
        if (inRack(d, p.rack.totalU || 42)) where.set(d.id, { p, d });
        else invalid.add(d.id);
    }
    const selves = ids.map((id) => where.get(id)).filter((w): w is Where => w != null);
    if (selves.length === 0) return { cables: [], peerRacks };

    const trayY = Math.max(...placed.map((p) => rackHeight(p.rack.totalU || 42))) + 0.35;
    const aisleX = Math.max(...placed.map((p) => p.x)) + RACK_W / 2 + 0.6;
    const placement = (p: PlacedRack<SceneRack>) => ({ x: p.x, z: p.z, rotationY: p.rotationY, rackTop: rackHeight(p.rack.totalU || 42) });
    const slotOf = (w: Where, portId: number | null) =>
        portId == null ? null : portFace(w.d, (w.d.uHeight || 1) * U - 0.0015)?.slots.find((s) => s.portId === portId) ?? null;
    const isNetwork = (w: Where) => deviceKind(w.d.categoryName, w.d.name) === "network";

    // One lane per cable across all watched devices, so two devices never draw
    // their cables at the same height.
    let lane = -1;
    const seen = new Set<string>();
    const cables = selves.flatMap((self) =>
        self.d.ports
            .filter((port) => {
                if (port.connectedToDeviceId == null || invalid.has(port.connectedToDeviceId)) return false;
                const ends = [`${self.d.id}:${port.id}`, `${port.connectedToDeviceId}:${port.connectedToPortId ?? `from-${port.id}`}`].sort().join("|");
                if (seen.has(ends)) return false;
                seen.add(ends);
                return true;
            })
            .map((port): CableInfo => {
                lane += 1;
                const mySlot = slotOf(self, port.id);
                const peer = where.get(port.connectedToDeviceId!);
                if (peer) peerRacks.add(peer.p.rack.name);
                const a = portAnchor(placement(self.p), self.d, mySlot, slides?.get(self.d.id) ?? (self.d.id === selectedDeviceId ? slide : 0));
                const b = peer ? portAnchor(placement(peer.p), peer.d, slotOf(peer, port.connectedToPortId), slides?.get(peer.d.id) ?? (peer.d.id === selectedDeviceId ? slide : 0)) : null;
                const kind = cableKind(port.portMode, mySlot?.uplink ?? false, peer ? isNetwork(peer) : false, isNetwork(self));
                return {
                    key: String(port.id),
                    points: routeCable(a, b, { trayY, aisleX, lane, sameRack: peer?.p === self.p }),
                    color: CABLE_COLOR[kind],
                    label: peer ? null : "to another room",
                };
            }),
    );
    return { cables, peerRacks };
}
