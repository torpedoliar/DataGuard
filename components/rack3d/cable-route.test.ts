import { describe, expect, it } from "vitest";
import type { SceneRack } from "@/lib/rack-filter";
import type { RackDevice, RackDevicePort } from "@/actions/rack-layout";
import { layoutRacks } from "./layout";
import { buildCables, cableKind, routeCable, type Anchor, type Vec3 } from "./cable-route";

const anchor = (x: number, y: number, z: number, rowZ: number, facing: 1 | -1 = 1): Anchor =>
  ({ pos: [x, y, z], facing, rowZ, rackTop: 2 });
const axisAligned = (pts: Vec3[]) => pts.slice(1).every((p, i) =>
  p.filter((v, k) => Math.abs(v - pts[i][k]) > 1e-9).length === 1);

describe("routeCable", () => {
  const opts = { trayY: 2.4, aisleX: 3, lane: 0, sameRack: false };

  it("runs port to port along the tray with right angles only (same row)", () => {
    const a = anchor(0, 1, 0.5, 0);
    const b = anchor(1.2, 0.8, 0.5, 0);
    const pts = routeCable(a, b, opts);
    expect(pts[0]).toEqual(a.pos);
    expect(pts[pts.length - 1]).toEqual(b.pos);
    expect(axisAligned(pts)).toBe(true);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(2.4);
    expect(pts.some((p) => p[0] === 3)).toBe(false); // no detour via the row end
  });

  it("crosses rows via the end of the rows", () => {
    const pts = routeCable(anchor(0, 1, 0.5, 0), anchor(0.6, 1, 1.7, 2.2, -1), opts);
    expect(axisAligned(pts)).toBe(true);
    expect(pts.filter((p) => p[0] === 3).map((p) => p[2])).toEqual([0, 2.2]);
  });

  it("loops in front of the rack for a same-rack link (never up to the tray)", () => {
    const a = anchor(0.1, 1.2, 0.8, 0);
    const b = anchor(-0.1, 0.9, 0.5, 0);
    const pts = routeCable(a, b, { ...opts, sameRack: true });
    expect(axisAligned(pts)).toBe(true);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(1.2);
    expect(pts[pts.length - 1]).toEqual(b.pos);
  });

  it("stops just above the rack when the peer is not in this room", () => {
    const pts = routeCable(anchor(0, 1, 0.5, 0), null, opts);
    expect(pts[pts.length - 1][1]).toBeCloseTo(2.15);
    expect(axisAligned(pts)).toBe(true);
  });

  it("separates parallel cables by lane", () => {
    const a = anchor(0, 1, 0.5, 0);
    const b = anchor(1.2, 1, 0.5, 0);
    const top = (lane: number) => Math.max(...routeCable(a, b, { ...opts, lane }).map((p) => p[1]));
    expect(top(1)).toBeGreaterThan(top(0));
  });
});

describe("cableKind", () => {
  it("uplink for uplink ports or switch-to-switch, else by port mode", () => {
    expect(cableKind("Access", true, false, false)).toBe("uplink");
    expect(cableKind("Trunk", false, true, true)).toBe("uplink");
    expect(cableKind("Trunk", false, false, true)).toBe("trunk");
    expect(cableKind(null, false, false, true)).toBe("access");
  });
});

describe("buildCables", () => {
  const port = (id: number, extra: Partial<RackDevicePort> = {}): RackDevicePort => ({
    id, portName: `Gi${id}`, portIndex: null, mediaType: null, status: "Active",
    portMode: "Access", connectedToDeviceId: null, connectedToPortId: null, ...extra,
  });
  const dev = (id: number, rackPosition: number, ports: RackDevicePort[] = []): RackDevice & { isMuted: boolean } => ({
    id, name: `D${id}`, brandName: null, brandLogo: null, categoryId: 1, categoryName: "Server", categoryColor: null,
    locationName: "Room", photoPath: null, rackName: null, rackPosition, uHeight: 1, zone: null, status: "OK",
    faceplatePortCount: null, faceplateUplinkCount: null, faceplateRows: null, faceplateNumbering: null, ports,
    isCritical: false, ipAddress: null, assetCode: null, openIncidents: { count: 0, maxSeverity: null }, isMuted: false,
  });
  const rack = (name: string, slot: number, devices: ReturnType<typeof dev>[]): SceneRack => ({
    name, zone: null, totalU: 42, devices, occupiedU: [], locationName: "Room", locationId: 1,
    floorRow: "A", floorSlot: slot, facing: "front", hasMatchingDevices: true, dimmed: false,
  });

  it("draws one cable per connected port and reports the peer rack", () => {
    const placed = layoutRacks([
      rack("R1", 1, [dev(1, 10, [port(11, { connectedToDeviceId: 2, connectedToPortId: 21 }), port(12)])]),
      rack("R2", 2, [dev(2, 5, [port(21)])]),
    ]);
    const { cables, peerRacks } = buildCables(placed, 1);
    expect(cables).toHaveLength(1);
    expect(cables[0].label).toBeNull();
    expect([...peerRacks]).toEqual(["R2"]);
  });

  it("labels a cable whose peer is not in this room", () => {
    const placed = layoutRacks([rack("R1", 1, [dev(1, 10, [port(11, { connectedToDeviceId: 99 })])])]);
    const { cables, peerRacks } = buildCables(placed, 1);
    expect(cables[0].label).toBe("to another room");
    expect(peerRacks.size).toBe(0);
  });

  it("draws nothing without a selection", () => {
    expect(buildCables(layoutRacks([rack("R1", 1, [dev(1, 10)])]), null).cables).toEqual([]);
  });
});
