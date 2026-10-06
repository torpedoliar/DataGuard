import React, { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneRack } from "@/lib/rack-filter";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, changed: false }));
vi.mock("react", async (original) => ({
    ...await original<typeof import("react")>(),
    useState: (initial: unknown) => {
        const index = hooks.cursor++;
        if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
        return [hooks.values[index], (value: unknown) => { const next = typeof value === "function" ? value(hooks.values[index]) : value; if (next !== hooks.values[index]) hooks.changed = true; hooks.values[index] = next; }];
    },
    useMemo: (run: () => unknown) => run(), useRef: () => ({ current: null }), useEffect: () => {},
}));
vi.mock("next/dynamic", () => ({ default: () => "rack-scene" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/actions/network", () => ({ getPortsByDevice: vi.fn(), updatePort: vi.fn() }));
vi.mock("@/actions/master-data", () => ({ getDevices: vi.fn() }));
vi.mock("@/components/admin/device-drawer-sections", () => ({ useDeviceDrawer: () => ({ data: null, loading: true, error: false }) }));
vi.mock("@/components/admin/device-detail-panel", () => ({ default: "detail-panel" }));
vi.mock("./appearance-panel", () => ({ AppearancePanel: "appearance-panel" }));
vi.mock("./critical-alert", () => ({ CriticalAlert: "critical-alert" }));
vi.mock("./peer-rack-card", () => ({ PeerRackCard: "peer-card" }));
import RackView3D from "./rack-view-3d";
function find(tree: ReactElement, type: string): ReactElement {
    if (tree.type === type) return tree;
    for (const child of React.Children.toArray((tree.props as { children?: React.ReactNode }).children)) {
        if (React.isValidElement(child)) { try { return find(child, type); } catch {} }
    }
    throw new Error(`Missing ${type}`);
}
function findByProp(tree: ReactElement, key: string, value: unknown): ReactElement {
    if ((tree.props as Record<string, unknown>)[key] === value) return tree;
    for (const child of React.Children.toArray((tree.props as { children?: React.ReactNode }).children)) {
        if (React.isValidElement(child)) { try { return findByProp(child, key, value); } catch {} }
    }
    throw new Error(`Missing ${key}`);
}
const devices = [1, 2, 3].map((id) => ({ id, name: `Device ${id}`, rackPosition: id, uHeight: 1, ports: [], status: "OK", openIncidents: { count: 0 }, locationName: "Room", rackName: "Rack" }));
const racks = [{ name: "Rack", totalU: 42, locationName: "Room", devices, occupiedU: [] }] as unknown as SceneRack[];
function render(selectedDeviceId = 1) {
    let tree: ReactElement;
    do {
        hooks.cursor = 0; hooks.changed = false;
        tree = RackView3D({ racks, rooms: {}, selectedDeviceId, autoFocusDeviceId: null, onSelectDevice: () => {}, onSelectPeer: () => true, onWebglUnavailable: () => {}, canEditAppearance: false, siteName: "Site" });
    } while (hooks.changed);
    return tree!;
}
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
describe("RackView3D integration", () => {
    it("opens a selected floor asset in a room with no racks and keeps unknown kW", () => {
        const facility = { ...devices[0], id: 500, assetType: "ups", facilitySpecs: { subtype: "floor-standing", capacityKva: 20, ratedKw: null }, rackName: null, rackPosition: null, uHeight: null, locationId: 7, locationName: "Power room", floorX: 2, floorZ: 3 } as unknown as import("@/actions/rack-layout").RackDevice;
        let tree: ReactElement;
        do {
            hooks.cursor = 0; hooks.changed = false;
            tree = RackView3D({ racks: [], facilities: [facility], rooms: {}, selectedDeviceId: 500, autoFocusDeviceId: null, onSelectDevice: () => {}, onSelectPeer: () => true, onWebglUnavailable: () => {}, canEditAppearance: false, siteName: "Site" });
        } while (hooks.changed);
        expect((find(tree!, "rack-scene").props as { facilities: unknown[] }).facilities).toEqual([facility]);
        const card = (find(tree!, "rack-scene").props as { floatCard: (d: unknown) => ReactElement }).floatCard(facility);
        expect((card.props as { device: unknown }).device).toBe(facility);
        expect(() => find(tree!, "detail-panel")).toThrow();
    });
    it("opens the panel without moving selection and shares the selected device's loading state", () => {
        const card = (find(render(), "rack-scene").props as { floatCard: (device: unknown) => ReactElement }).floatCard(devices[0]);
        (card.props as { onOpenPanel: () => void }).onOpenPanel();
        const tree = render();
        expect((find(tree, "detail-panel").props as { device: { id: number }; networkState: { loading: boolean } }).device.id).toBe(1);
        expect((find(tree, "detail-panel").props as { networkState: { loading: boolean } }).networkState.loading).toBe(true);
        expect((find(tree, "rack-scene").props as { selectedDeviceId: number }).selectedDeviceId).toBe(1);
    });
    it("keeps scene controls inside narrow containers when the panel opens", () => {
        const card = (find(render(), "rack-scene").props as { floatCard: (device: unknown) => ReactElement }).floatCard(devices[0]);
        (card.props as { onOpenPanel: () => void }).onOpenPanel();
        const tree = render();
        const scene = findByProp(tree, "aria-label", "3D rack scene");
        expect((scene.props as { className: string }).className).toContain("@container");
        const controls = findByProp(scene, "data-keep-tour", true);
        expect((controls.props as { className: string }).className).toContain("@[640px]:right-[calc(24rem+0.75rem)]");
        expect((controls.props as { className: string }).className).toContain("right-3");
    });
    it("opens a cross-room rack preview without sending its peer to the current room's scene", () => {
        const other = { ...racks[0], name: "Other rack", locationName: "Other room", devices: [{ ...devices[1], locationName: "Other room", rackName: "Other rack" }] } as unknown as SceneRack;
        racks.push(other);
        const original = racks[0].devices;
        racks[0].devices = original.filter((device) => device.id !== 2);
        try {
            const card = (find(render(), "rack-scene").props as { floatCard: (device: unknown) => ReactElement }).floatCard(devices[0]);
            (card.props as { onPickPort: (port: unknown) => void }).onPickPort({ connectedToDeviceId: 2 });
            const tree = render();
            expect((find(tree, "rack-scene").props as { peerDeviceId: number | null }).peerDeviceId).toBeNull();
            expect((find(tree, "peer-card").props as { peer: { id: number } }).peer.id).toBe(2);
        } finally { racks.pop(); racks[0].devices = original; }
    });
    it("clears the previous base device's peer when selecting another device in the same room", () => {
        const scene = find(render(), "rack-scene");
        const card = (scene.props as { floatCard: (device: unknown) => ReactElement }).floatCard(devices[0]);
        (card.props as { onPickPort: (port: unknown) => void }).onPickPort({ connectedToDeviceId: 2 });
        expect((find(render(), "rack-scene").props as { peerDeviceId: number }).peerDeviceId).toBe(2);
        expect((find(render(3), "rack-scene").props as { peerDeviceId: number | null }).peerDeviceId).toBeNull();
    });
});
