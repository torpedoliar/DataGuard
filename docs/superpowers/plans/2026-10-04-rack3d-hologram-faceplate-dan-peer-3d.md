# Rack3D Hologram Faceplate + Peer 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hologram's scrollable port list with the documented faceplate (hover a slot for VLAN + peer, click it for a detail panel plus the peer on screen), and show a same-room peer as a second hologram or an other-room peer as a 3D rack mini-card — without moving the camera.

**Architecture:** All new decision logic is pure and unit-tested (`hologramStagger`, the list-based `buildCables`); the R3F components only render what those return. `DeviceHologram` becomes faceplate-driven and owns one hovered + one selected slot, with optional props so the same component serves the main hologram and the peer hologram. The other-room peer gets a separate small `<Canvas>` (never touching the main scene's composer or shared LED materials), split into an R3F-only module and a DOM shell so the shell is testable in the repo's node test environment.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest 4 (node env, no jsdom, no @testing-library), three 0.186 + @react-three/fiber 9 + drei 10, Tailwind (`ops-*` tokens).

**Spec:** `docs/superpowers/specs/2026-10-04-rack3d-hologram-faceplate-dan-peer-3d-design.md`

## Global Constraints

- No new dependency. No jsdom, no `@testing-library`: the test seam props below are the testing strategy.
- No migration, and **no change to `actions/network.ts`** — `getPortsByDevice` already selects `trunkVlans` (`actions/network.ts:123`), so `FloatPort` is already structurally identical to `NetworkPortRow`.
- No new provisioning path in the hologram: `QuickAddPortModal` / `addPort` / `getVlans` are not touched. The hologram only *links* existing ports via `PortLinkDialog` → `updatePort`.
- The empty-slot branch of `describeSlot` ends with "klik untuk provisioning port" (`components/admin/device-faceplate.tsx:50`), which is wrong in the hologram. The hologram uses `describeSlot` **only for occupied slots**.
- Card width `w-72` → `w-80`. Stagger offsets are exactly `±9rem`. Stagger proximity threshold is `|Δu| < 4`.
- Same location + same rack is a hard gate before any stagger; `rackName == null` means no stagger.
- `rackPosition` of `0` or negative is treated as unknown (`null`), because racks start at U1.
- At most 2 holograms. Only the main hologram drives peer movement (`onPickPort` is not passed to the peer hologram).
- New hologram copy is English ("Faceplate not configured", "empty", "Loading ports…", "Panel", "Full Docs"); hover strip + `aria-label` for occupied slots stay Indonesian via `describeSlot`.
- Filled cards keep the panel dock keyed to a **device id**, not a boolean.
- Gate per task: `npx vitest run <test files> --exclude "**/.kilo/**"`, `npx tsc --noEmit`, `npx eslint <changed files>`. Final gate: `npm run test`, `npm run typecheck`, `npm run lint`. Run vitest with `--exclude "**/.kilo/**"`: the repo is duplicated inside `.kilo/worktrees/polydactyl-lobe/` and `vitest.config.ts` does not exclude it, so without the flag every test file runs twice. The same duplication is the only source of lint errors in the repo (4 × `no-require-imports` in `.kilo/.../scripts/*.js`); `npx eslint --ignore-pattern ".kilo/**"` is clean (0 errors, ~114 pre-existing warnings). Do not "fix" those 4 — they are in a worktree, not in the project.
- Commits: conventional subjects, one commit per task.

## Review Focus

1. **Empty slot promises an action it does not have.** A user hovers slot 3 on a switch with 4 declared ports and 2 documented; the strip must say it is empty, not "klik untuk provisioning port". Pinned by Task 3's `hoveredSlotKey="access-3"` test asserting `"empty"` present and `"provisioning"` absent.
2. **A configured faceplate with zero documented ports.** The device has `faceplatePortCount: 4` but no rows in `network_ports`; the card must still draw the faceplate (all slots dashed) and show `0/0 Linked`, with no crash and no message that replaces the faceplate. Pinned by Task 3's `ports={[]}` test.
3. **Two devices at the same U in different rooms.** The spec's stagger gate is location + rack; two devices that are far apart on screen must not be pushed `±9rem` for nothing. Pinned by Task 1's `locationName`/`rackName` gate tests.
4. **The rack peer disappears from the scene while a rack is focused.** `RackScene` only renders the focused row plus `peerRacks`; a same-room peer in another rack falls outside both, so its hologram would have no device to attach to. Pinned by Task 2's two-id `buildCables` test.
5. **A peer device with no rack location.** An other-room peer card whose rack has `locationName: null` must read "Unassigned Location" in the header, not "null". Pinned by Task 4's unassigned-room test.

Not pinned by an automated test (no harness for `RackView3D`: it is a client component that reads WebGL and loads the scene through `next/dynamic`): the wiring in Task 5 — peer reset on room change, Escape / `onPointerMissed` clearing both holograms, no third hologram when a link is saved from the peer card, and the self-link guard. Task 5 therefore carries an explicit browser check list instead of tests.

---

### Task 1: `hologramStagger` — placement when two devices share a U range

**Files:**
- Create: `components/rack3d/hologram-offset.ts`
- Create: `components/rack3d/hologram-offset.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type HologramAnchor = { locationName: string | null; rackName: string | null; u: number | null }`
  - `function hologramStagger(base: HologramAnchor, peer: HologramAnchor): { base: number; peer: number }` — returns rem offsets for the outer `translateY` of the main (`base`) and peer hologram.

- [ ] **Step 1: Write the failing test**

`components/rack3d/hologram-offset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hologramStagger, type HologramAnchor } from "./hologram-offset";

// Same location + same rack unless a test says otherwise.
const at = (u: number | null, over: Partial<HologramAnchor> = {}): HologramAnchor =>
  ({ locationName: "Room A", rackName: "R1", u, ...over });

describe("hologramStagger", () => {
  it("pushes the lower U down and the higher U up for adjacent units in one rack", () => {
    expect(hologramStagger(at(10), at(11))).toEqual({ base: 9, peer: -9 });
  });

  it("leaves both alone when the units are far apart in the same rack", () => {
    expect(hologramStagger(at(10), at(20))).toEqual({ base: 0, peer: 0 });
  });

  it("leaves both alone in a different rack or a different location", () => {
    expect(hologramStagger(at(10), at(11, { rackName: "R2" }))).toEqual({ base: 0, peer: 0 });
    expect(hologramStagger(at(10), at(11, { locationName: "Room B" }))).toEqual({ base: 0, peer: 0 });
  });

  it("leaves both alone when either rack name is unknown", () => {
    expect(hologramStagger(at(10, { rackName: null }), at(11))).toEqual({ base: 0, peer: 0 });
    expect(hologramStagger(at(10), at(11, { rackName: null }))).toEqual({ base: 0, peer: 0 });
  });

  it("puts the base below the peer when the base sits higher", () => {
    expect(hologramStagger(at(12), at(11))).toEqual({ base: -9, peer: 9 });
  });

  it("puts the base above the peer when both units are equal", () => {
    expect(hologramStagger(at(10), at(10))).toEqual({ base: -9, peer: 9 });
  });

  it("assumes the unknown side is the higher one", () => {
    expect(hologramStagger(at(null), at(null))).toEqual({ base: -9, peer: 9 });
    expect(hologramStagger(at(null), at(11))).toEqual({ base: -9, peer: 9 });
    expect(hologramStagger(at(10), at(null))).toEqual({ base: 9, peer: -9 });
  });

  it("treats U0 or a negative U as unknown", () => {
    expect(hologramStagger(at(0), at(11))).toEqual({ base: -9, peer: 9 });
    expect(hologramStagger(at(-3), at(11))).toEqual({ base: -9, peer: 9 });
  });

  it("applies the same rules after the proximity gate, not instead of it", () => {
    // Unknown on both sides is still not a reason to shift across racks.
    expect(hologramStagger(at(null), at(null, { rackName: "R2" }))).toEqual({ base: 0, peer: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/rack3d/hologram-offset.test.ts --exclude "**/.kilo/**"`
Expected: FAIL — `Failed to resolve import "./hologram-offset"`.

- [ ] **Step 3: Write the implementation**

`components/rack3d/hologram-offset.ts`:

```ts
/**
 * Placement of two device holograms that would otherwise overlap.
 *
 * Two 1U devices next to each other are only a few pixels apart on screen while
 * the card is ~260 px tall, so the cards are pushed apart with a CSS
 * translateY. The offset is applied in screen space (inside the drei <Html>),
 * not as a world position, so it stays put while the camera orbits.
 */

export type HologramAnchor = {
    locationName: string | null;
    rackName: string | null;
    /** 1-based rack slot; 0 / negative / null all mean "unknown". */
    u: number | null;
};

export type HologramOffsets = { base: number; peer: number };

/** ponytail: 9rem covers a ~260px card; if the card grows taller, measure it. */
const SHIFT = 9;

/** Racks start at U1, so 0 and negatives carry no position information. */
function unit(u: number | null): number | null {
    return u != null && u > 0 ? u : null;
}

export function hologramStagger(base: HologramAnchor, peer: HologramAnchor): HologramOffsets {
    // Only two devices that can actually land on top of each other need a shift:
    // same room, same rack, known rack name.
    if (base.rackName == null || peer.rackName == null) return { base: 0, peer: 0 };
    if (base.locationName !== peer.locationName) return { base: 0, peer: 0 };
    if (base.rackName !== peer.rackName) return { base: 0, peer: 0 };

    const bu = unit(base.u);
    const pu = unit(peer.u);

    // Unknown U counts as "above": an unpositioned device may sit anywhere, and
    // keeping the pair separated is better than stacking two cards.
    if (bu == null && pu == null) return { base: -SHIFT, peer: SHIFT };
    if (bu == null) return { base: -SHIFT, peer: SHIFT };
    if (pu == null) return { base: SHIFT, peer: -SHIFT };
    if (Math.abs(bu - pu) >= 4) return { base: 0, peer: 0 };

    return bu < pu ? { base: SHIFT, peer: -SHIFT } : { base: -SHIFT, peer: SHIFT };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/rack3d/hologram-offset.test.ts --exclude "**/.kilo/**"`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and lint the new files**

Run: `npx tsc --noEmit && npx eslint components/rack3d/hologram-offset.ts components/rack3d/hologram-offset.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/rack3d/hologram-offset.ts components/rack3d/hologram-offset.test.ts
git commit -m "feat(rack3d): hologramStagger untuk dua hologram di U berdekatan"
```

---

### Task 2: `buildCables` takes every id it must keep rendered

**Files:**
- Modify: `components/rack3d/cable-route.ts:79-113`
- Modify: `components/rack3d/cable-route.test.ts:64-101`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `buildCables(placed: PlacedRack<SceneRack>[], selectedDeviceIds: (number | null)[]): { cables: CableInfo[]; peerRacks: Set<string> }` — replaces the single-id signature.

- [ ] **Step 1: Update the test to the new signature and add the two-device case**

Replace the whole `describe("buildCables", ...)` block in `components/rack3d/cable-route.test.ts` (lines 64-101) with:

```ts
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
    const { cables, peerRacks } = buildCables(placed, [1]);
    expect(cables).toHaveLength(1);
    expect(cables[0].label).toBeNull();
    expect([...peerRacks]).toEqual(["R2"]);
  });

  it("keeps the rack of every watched device so a focused row still renders them", () => {
    // Device 1 (R1) links to 2 (R2); device 2 links to 3 (R3). Watching both
    // ends must keep R2 and R3 declared, or a focused row drops them from the
    // scene and the second hologram has no device to attach to.
    const placed = layoutRacks([
      rack("R1", 1, [dev(1, 10, [port(11, { connectedToDeviceId: 2, connectedToPortId: 21 })])]),
      rack("R2", 2, [dev(2, 5, [port(21, { connectedToDeviceId: 3, connectedToPortId: 31 })])]),
      rack("R3", 3, [dev(3, 7, [port(31)])]),
    ]);
    const { cables, peerRacks } = buildCables(placed, [1, 2]);
    expect(cables.map((c) => c.key).sort()).toEqual(["11", "21"]);
    expect([...peerRacks].sort()).toEqual(["R2", "R3"]);
  });

  it("ignores null entries in the watch list", () => {
    const placed = layoutRacks([rack("R1", 1, [dev(1, 10, [port(11, { connectedToDeviceId: 99 })])])]);
    const { cables, peerRacks } = buildCables(placed, [1, null]);
    expect(cables[0].label).toBe("to another room");
    expect(peerRacks.size).toBe(0);
  });

  it("draws nothing without a selection", () => {
    expect(buildCables(layoutRacks([rack("R1", 1, [dev(1, 10)])]), []).cables).toEqual([]);
    expect(buildCables(layoutRacks([rack("R1", 1, [dev(1, 10)])]), [null]).cables).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/rack3d/cable-route.test.ts --exclude "**/.kilo/**"`
Expected: FAIL — the two-id test gets only device 1's cable (`cables` has 1 entry, `peerRacks` is `["R2"]`), and the array-vs-number calls make the other tests fail too.

- [ ] **Step 3: Widen the implementation**

In `components/rack3d/cable-route.ts`, replace the `buildCables` header, early return, and the `self`/`cables` wiring:

```ts
// Cables of every watched device to its documented peers, plus the racks those
// peers sit in (the scene keeps them visible and un-faded). More than one
// device is watched at a time because a same-room peer gets its own hologram,
// and a focused row must keep the peer's rack on screen.
export function buildCables(placed: PlacedRack<SceneRack>[], watchedDeviceIds: (number | null)[]): { cables: CableInfo[]; peerRacks: Set<string> } {
    const peerRacks = new Set<string>();
    const ids = watchedDeviceIds.filter((id): id is number => id != null);
    if (ids.length === 0 || placed.length === 0) return { cables: [], peerRacks };

    type Where = { p: PlacedRack<SceneRack>; d: SceneRack["devices"][number] };
    const where = new Map<number, Where>();
    for (const p of placed) for (const d of p.rack.devices) where.set(d.id, { p, d });
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
    const cables = selves.flatMap((self) =>
        self.d.ports
            .filter((port) => port.connectedToDeviceId != null)
            .map((port): CableInfo => {
                lane += 1;
                const mySlot = slotOf(self, port.id);
                const peer = where.get(port.connectedToDeviceId!);
                if (peer) peerRacks.add(peer.p.rack.name);
                const a = portAnchor(placement(self.p), self.d, mySlot, SLIDE);
                const b = peer ? portAnchor(placement(peer.p), peer.d, slotOf(peer, port.connectedToPortId)) : null;
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
```

The cable `key` gains the device id prefix: two devices in one room can both have a port with id 11 in a two-site/routing edge case only if they are the same device, but a peer device's own cables now also appear, and React needs distinct keys across them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/rack3d/cable-route.test.ts --exclude "**/.kilo/**"`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck to find the call site**

Run: `npx tsc --noEmit`
Expected: FAIL in `components/rack3d/rack-scene.tsx` — `buildCables(placed, selectedDeviceId)` no longer matches `(number | null)[]`. This is fixed in Task 5; note it and continue.

- [ ] **Step 6: Commit**

```bash
git add components/rack3d/cable-route.ts components/rack3d/cable-route.test.ts
git commit -m "feat(rack3d): buildCables menerima daftar device yang dijaga"
```

---

### Task 3: `DeviceHologram` renders the faceplate

**Files:**
- Modify: `components/rack3d/device-hologram.tsx` (props block, body, footer)
- Modify: `components/rack3d/device-hologram.test.tsx` (full rewrite, below)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces (all consumed by Task 5):
  - `interface DeviceHologramProps` with `device: Pick<RackDevice, "id" | "name" | "ipAddress" | "status" | "openIncidents" | "faceplatePortCount" | "faceplateUplinkCount" | "faceplateRows" | "faceplateNumbering" | "rackPosition" | "rackName" | "locationName">`
  - `onPickPort?: (port: FloatPort) => void` — **now optional**; omitted by the peer hologram.
  - `offsetY?: number` — default `0`, applied as `transform: translateY(<n>rem)` on the outer div.
  - `hoveredSlotKey?: string | null`, `selectedSlotKey?: string | null` — test seam; when provided they override the internal state.
  - `FloatPort` and `HologramDeviceOption` keep their current exported shapes.

- [ ] **Step 1: Rewrite the test**

Replace `components/rack3d/device-hologram.test.tsx` entirely:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// The hologram reads audit/SIEM summary through the shared drawer hook.
vi.mock("@/components/admin/device-drawer-sections", () => ({
    useDeviceDrawer: () => ({ loading: false, data: null }),
}));

import { DeviceHologram } from "./device-hologram";

// Two ports on a 4-slot, one-row faceplate: slots 1 and 2 are occupied
// (1 wired to SW-2, 2 unlinked) and slots 3 and 4 are empty.
const ports = [
    {
        id: 1, deviceId: 1, portName: "1", portIndex: 1, macAddress: null, ipAddress: null,
        portMode: "Access", vlanId: 3, vlanName: "SRV", vlanNumber: 10, trunkVlans: null,
        status: "Active", speed: null, mediaType: null,
        connectedToDeviceId: 7, connectedToDeviceName: "SW-2",
        connectedToPortId: 9, connectedToPortName: "5", description: null,
    },
    {
        id: 2, deviceId: 1, portName: "2", portIndex: 2, macAddress: null, ipAddress: null,
        portMode: "Access", vlanId: null, vlanName: null, vlanNumber: null, trunkVlans: null,
        status: "Inactive", speed: null, mediaType: null,
        connectedToDeviceId: null, connectedToDeviceName: null,
        connectedToPortId: null, connectedToPortName: null, description: null,
    },
];

const device = {
    id: 1, name: "SW-1", ipAddress: "10.0.0.1", status: "OK",
    openIncidents: { count: 0, items: [] },
    faceplatePortCount: 4, faceplateUplinkCount: 0, faceplateRows: 1, faceplateNumbering: "sequential",
    rackPosition: 10, rackName: "R1", locationName: "Room A",
} as never;

const baseProps = {
    ports: ports as never,
    loading: false,
    deviceOptions: [{ id: 7, name: "SW-2", locationName: "Room A" }],
    onClose: () => {},
    onLinked: () => {},
    onOpenPanel: () => {},
};

describe("DeviceHologram faceplate", () => {
    it("draws one slot per declared port and a linked count", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("SW-1");
        expect(html).toContain("1/2 Linked");
        // Only the two occupied slots are interactive.
        expect(html.split('role="button"').length - 1).toBe(2);
        expect(html).toContain(">3<");
        expect(html).toContain(">4<");
    });

    it("describes the hovered occupied slot through the 2D strip text", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} hoveredSlotKey="access-1" />);
        expect(html).toContain("VLAN 10");
        expect(html).toContain("SW-2");
    });

    it("never promises provisioning on an empty slot", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} hoveredSlotKey="access-3" />);
        expect(html).toContain("empty");
        expect(html).not.toContain("provisioning");
    });

    it("opens a detail panel with the link entry point for an occupied slot", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} selectedSlotKey="access-1" />);
        expect(html).toContain("Edit link");
    });

    it("offers the link button for an occupied slot that has no peer yet", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} selectedSlotKey="access-2" />);
        expect(html).toContain("Edit link");
        expect(html).toContain("Not linked");
    });

    it("opens nothing for an empty slot", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} selectedSlotKey="access-3" />);
        expect(html).not.toContain("Edit link");
    });

    it("falls back to a message with a network-docs link when no faceplate is configured", () => {
        const bare = { ...(device as object), faceplatePortCount: 0 } as never;
        const html = renderToStaticMarkup(<DeviceHologram device={bare} {...baseProps} />);
        expect(html).toContain("Faceplate not configured");
        expect(html).toContain("/admin/devices/1/network");
    });

    it("keeps an empty faceplate on screen when the device documents no ports", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} ports={[]} />);
        expect(html).toContain("0/0 Linked");
        expect(html).not.toContain("No ports documented");
        expect(html.split('role="button"').length - 1).toBe(0);
    });

    it("keeps the loading and panel/full-docs entry points", () => {
        const loading = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} ports={[]} loading />);
        expect(loading).toContain("Loading ports");
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} />);
        expect(html).toContain("Panel");
        expect(html).toContain("/admin/devices/1/network");
    });

    it("applies the stagger offset as a translateY on the card", () => {
        const html = renderToStaticMarkup(<DeviceHologram device={device} {...baseProps} offsetY={-9} />);
        expect(html).toContain("translateY(-9rem)");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/rack3d/device-hologram.test.tsx --exclude "**/.kilo/**"`
Expected: FAIL — `role="button"` count is 0 (the port list uses `<button>`), `VLAN 10` never appears from a hover strip, and "Faceplate not configured" does not exist.

- [ ] **Step 3: Add the imports and the widened props**

At the top of `components/rack3d/device-hologram.tsx`, extend the imports:

Add these two lines to the existing import block at the top of `components/rack3d/device-hologram.tsx` (the file already imports `Link`, `useEffect`/`useState`, the four lucide icons, `getPortsByDevice`/`updatePort`, `RackDevice` and `useDeviceDrawer`; keep all of those):

```tsx
import { buildFaceplate, faceplateSlotColors, isUplinkMedia, isFaceplateConfigured, FACEPLATE_PALETTE, type FaceplateSlot } from "@/lib/faceplate";
import { describeSlot } from "@/components/admin/device-faceplate";
```

Then replace the `DeviceHologramProps` interface:

```tsx
type HologramDevice = Pick<RackDevice, "id" | "name" | "ipAddress" | "status" | "openIncidents" | "faceplatePortCount" | "faceplateUplinkCount" | "faceplateRows" | "faceplateNumbering" | "rackPosition" | "rackName" | "locationName">;

interface DeviceHologramProps {
    device: HologramDevice;
    ports: FloatPort[];
    loading: boolean;
    deviceOptions: HologramDeviceOption[];
    onClose: () => void;
    /**
     * Clicked a port that already has a peer: the caller decides what to show
     * (second hologram, rack card, or the peer's network docs). Omitted for the
     * peer's own hologram so it cannot spawn a third one.
     */
    onPickPort?: (port: FloatPort) => void;
    /** A new link was saved; the caller selects the target device. */
    onLinked: (targetDeviceId: number) => void;
    /** Open the full detail panel docked on the right, for this device. */
    onOpenPanel: () => void;
    /** Screen-space vertical offset in rem, from `hologramStagger`. */
    offsetY?: number;
    /** Test seam: render as if this slot were hovered / selected. */
    hoveredSlotKey?: string | null;
    /** Test seam: render as if this slot were hovered / selected. */
    selectedSlotKey?: string | null;
}
```

- [ ] **Step 4: Replace the component body**

Replace the whole `DeviceHologram` function body (lines 43-156 of the current file — everything from `export function DeviceHologram(` down to the closing `}` before the `// One dialog:` comment) with:

```tsx
const STATUS_DOT: Record<string, string> = {
    OK: "bg-ops-success",
    "NOT OK": "bg-ops-danger",
    Pending: "bg-ops-muted",
};

type HologramSlot = FaceplateSlot<FloatPort>;

// An empty slot has nothing to open: `describeSlot` ends its empty branch with
// "klik untuk provisioning port", which is true on the 2D faceplate but false
// here, so the hologram words empty slots itself.
const emptySlotLabel = (slot: HologramSlot) =>
    slot.block === "uplink" ? `Uplink slot ${slot.slotNumber} — empty` : `Slot ${slot.slotNumber} — empty`;

const slotLabel = (slot: HologramSlot) => (slot.port ? describeSlot(slot) : emptySlotLabel(slot));

// Network-docs hologram floating above the selected device in the 3D scene.
// DOM inside a plain drei <Html> (same proven pattern as the cable labels: no
// distanceFactor, so the pixel size stays constant and the text stays crisp —
// brightness comes from high-contrast tokens + glow, not canvas rasterisation).
// The body is the device's documented faceplate: hovering a slot shows its
// wiring, clicking an occupied one opens its detail panel, and the peer action
// is left to the caller through the optional `onPickPort`.
export function DeviceHologram({ device, ports, loading, deviceOptions, onClose, onPickPort, onLinked, onOpenPanel, offsetY = 0, hoveredSlotKey, selectedSlotKey }: DeviceHologramProps) {
    const linked = ports.filter((p) => p.connectedToDeviceId != null).length;
    const { data: drawer } = useDeviceDrawer(device.id);
    const [linkTarget, setLinkTarget] = useState<FloatPort | null>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const hovered = hoveredSlotKey !== undefined ? hoveredSlotKey : hoveredKey;
    const selected = selectedSlotKey !== undefined ? selectedSlotKey : selectedKey;

    const config = {
        portCount: device.faceplatePortCount,
        uplinkCount: device.faceplateUplinkCount,
        rows: device.faceplateRows,
        numbering: device.faceplateNumbering,
    };
    const configured = isFaceplateConfigured(config);
    const plate = configured ? buildFaceplate(config, ports) : null;
    const slots = plate?.slots ?? [];
    const hoveredSlot = slots.find((s) => s.key === hovered) ?? null;
    const selectedSlot = slots.find((s) => s.key === selected) ?? null;

    const peerOptions = deviceOptions.filter((d) => d.id !== device.id);
    const statusLabel = device.status ?? "Pending";

    const activate = (slot: HologramSlot) => {
        // Empty slots are display only: there is no port to link, and creating
        // ports stays in the network docs.
        if (!slot.port) return;
        setSelectedKey(slot.key);
        if (slot.port.connectedToDeviceId != null) onPickPort?.(slot.port);
    };

    return (
        <div
            className="w-80 rounded-xl border border-ops-accent/40 bg-ops-surface/95 shadow-[0_0_24px_-4px_var(--ops-accent)] backdrop-blur"
            style={offsetY ? { transform: `translateY(${offsetY}rem)` } : undefined}
        >
            <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ops-text">{device.name}</p>
                    <p className="truncate font-mono text-[11px] text-ops-muted">{device.ipAddress ?? "no IP"}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={`Close ${device.name} hologram`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
                >
                    <X className="size-3.5" />
                </button>
            </div>

            <div className="space-y-1 border-b border-ops-border px-3 py-2 text-[11px]">
                <p className="flex items-center gap-1.5 text-ops-text">
                    <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[statusLabel] ?? "bg-ops-muted"}`} />
                    <span className="font-semibold">{statusLabel}</span>
                    {device.openIncidents.count > 0 && (
                        <span className="ml-auto rounded px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "var(--ops-danger)" }}>
                            {device.openIncidents.count} incident{device.openIncidents.count > 1 ? "s" : ""}
                        </span>
                    )}
                </p>
                <p className="text-ops-muted">
                    Audit:{" "}
                    {drawer ? (
                        drawer.lastAudit
                            ? <span className="text-ops-text">{drawer.lastAudit.checkDate} · {drawer.lastAudit.status}</span>
                            : "never audited"
                    ) : "…"}
                </p>
                <p className="text-ops-muted">
                    SIEM:{" "}
                    {drawer ? (
                        drawer.siem.count > 0
                            ? <span className="font-semibold text-ops-warning">{drawer.siem.count} open</span>
                            : "clear"
                    ) : "…"}
                </p>
            </div>

            <div className="max-h-56 overflow-auto px-3 py-2">
                {loading ? (
                    <p className="py-2 text-center text-xs text-ops-muted">Loading ports…</p>
                ) : !plate ? (
                    <p className="space-y-1 py-2 text-center text-xs text-ops-muted">
                        <span className="block">Faceplate not configured.</span>
                        <Link href={`/admin/devices/${device.id}/network`} className="font-semibold text-ops-accent hover:underline">
                            Set it up in Full Docs
                        </Link>
                    </p>
                ) : (
                    <>
                        <svg
                            viewBox={`0 0 ${plate.width} ${plate.height}`}
                            // A 4-port plate would be a stamp in a 320px card, so it
                            // stretches to the card; a 48-port plate keeps its
                            // intrinsic width and scrolls instead of shrinking its
                            // slots below a hoverable size.
                            style={{ width: "100%", minWidth: `${plate.width}px` }}
                            role="group"
                            aria-label={`Faceplate ${device.name}, ${plate.slots.length} slots`}
                        >
                            <rect x={0} y={0} width={plate.width} height={plate.height} rx={3} fill={FACEPLATE_PALETTE.chassis.fill} stroke={FACEPLATE_PALETTE.chassis.stroke} strokeWidth={0.8} />
                            {plate.blocks.map((block) => (
                                <text key={block.block} x={block.x} y={block.labelY} fontSize={6} fill="#94a3b8" fontFamily="monospace">{block.label}</text>
                            ))}
                            {plate.slots.map((slot) => {
                                const colors = faceplateSlotColors(slot.port);
                                const uplinkSlot = slot.block === "uplink" || isUplinkMedia(slot.port?.mediaType);
                                const isHovered = hovered === slot.key;
                                const label = slotLabel(slot);
                                return (
                                    <g
                                        key={slot.key}
                                        role={slot.port ? "button" : undefined}
                                        tabIndex={slot.port ? 0 : undefined}
                                        aria-label={label}
                                        className={slot.port ? "cursor-pointer" : undefined}
                                        onClick={() => activate(slot)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                activate(slot);
                                            }
                                        }}
                                        onMouseEnter={() => setHoveredKey(slot.key)}
                                        onMouseLeave={() => setHoveredKey((cur) => (cur === slot.key ? null : cur))}
                                        onFocus={() => setHoveredKey(slot.key)}
                                        onBlur={() => setHoveredKey((cur) => (cur === slot.key ? null : cur))}
                                    >
                                        <title>{label}</title>
                                        <rect
                                            x={slot.x}
                                            y={slot.y}
                                            width={slot.width}
                                            height={slot.height}
                                            rx={1.5}
                                            fill={colors.fill}
                                            stroke={isHovered ? "#f8fafc" : colors.stroke}
                                            strokeWidth={isHovered ? 1.4 : 0.7}
                                            strokeDasharray={slot.port ? undefined : "2 1.5"}
                                        />
                                        {uplinkSlot ? (
                                            <rect x={slot.x + 3} y={slot.y + slot.height / 2 - 1.5} width={slot.width - 6} height={3} rx={0.6} fill="#000000" opacity={0.35} />
                                        ) : (
                                            <rect x={slot.x + slot.width / 2 - 3} y={slot.y + slot.height - 4.5} width={6} height={3} rx={0.5} fill="#000000" opacity={0.3} />
                                        )}
                                        {colors.accent && <rect x={slot.x} y={slot.y} width={2} height={slot.height} rx={1} fill={colors.accent} />}
                                        {slot.port?.connectedToPortId && (
                                            <circle cx={slot.x + slot.width - 2.6} cy={slot.y + 2.6} r={1.3} fill="#f8fafc" opacity={0.85} />
                                        )}
                                        <text
                                            x={slot.x + slot.width / 2}
                                            y={slot.y + slot.height / 2 + 1}
                                            textAnchor="middle"
                                            fontSize={7}
                                            fontFamily="monospace"
                                            fontWeight={600}
                                            fill={colors.label}
                                            pointerEvents="none"
                                        >
                                            {slot.slotNumber}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                        {plate.unplaced.length > 0 && (
                            <p className="mt-1 text-[11px] text-ops-muted">{plate.unplaced.length} port not on the faceplate</p>
                        )}
                    </>
                )}
            </div>

            {hoveredSlot && (
                <div className="border-b border-ops-border bg-ops-bg/60 px-3 py-1.5 text-[11px] text-ops-text">
                    <span className="block truncate">{slotLabel(hoveredSlot)}</span>
                </div>
            )}

            {selectedSlot?.port && (
                <div className="space-y-1 border-b border-ops-border bg-ops-bg/60 px-3 py-2 text-[11px]">
                    <p className="font-mono font-semibold text-ops-text">{selectedSlot.port.portName}</p>
                    <p className="text-ops-muted">{selectedSlot.port.status ?? "Status not set"}{selectedSlot.port.portMode ? ` · ${selectedSlot.port.portMode}` : ""}</p>
                    {(selectedSlot.port.speed || selectedSlot.port.mediaType) && (
                        <p className="text-ops-muted">{[selectedSlot.port.speed, selectedSlot.port.mediaType].filter(Boolean).join(" ")}</p>
                    )}
                    {selectedSlot.port.trunkVlans && <p className="text-ops-muted">Trunk: {selectedSlot.port.trunkVlans}</p>}
                    {selectedSlot.port.description && <p className="text-ops-muted">&ldquo;{selectedSlot.port.description}&rdquo;</p>}
                    <p className={selectedSlot.port.connectedToDeviceId != null ? "text-ops-text" : "text-ops-muted"}>
                        {selectedSlot.port.connectedToDeviceId != null
                            ? `→ ${selectedSlot.port.connectedToDeviceName ?? "unknown"}${selectedSlot.port.connectedToPortName ? ` :${selectedSlot.port.connectedToPortName}` : ""}`
                            : "Not linked"}
                    </p>
                    <div className="flex justify-end gap-2 pt-0.5">
                        <button
                            type="button"
                            onClick={() => setSelectedKey(null)}
                            className="rounded-md border border-ops-border px-2 py-1 text-ops-text hover:bg-ops-surface-raised"
                        >
                            Tutup
                        </button>
                        <button
                            type="button"
                            onClick={() => setLinkTarget(selectedSlot.port)}
                            className="flex items-center gap-1 rounded-md bg-ops-accent px-2 py-1 font-semibold text-white hover:opacity-90"
                        >
                            <Link2 className="size-3" /> Edit link
                        </button>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-ops-border px-3 py-2">
                <span className="font-mono text-[11px] text-ops-success">{linked}/{ports.length} Linked</span>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onOpenPanel}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-text hover:bg-ops-surface-raised"
                    >
                        <PanelRightOpen className="size-3" /> Panel
                    </button>
                    <Link
                        href={`/admin/devices/${device.id}/network`}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-accent hover:bg-ops-accent/10"
                    >
                        Full Docs <ExternalLink className="size-3" />
                    </Link>
                </div>
            </div>

            {linkTarget && (
                <PortLinkDialog
                    port={linkTarget}
                    deviceOptions={peerOptions}
                    onClose={() => setLinkTarget(null)}
                    onSaved={(targetDeviceId) => { setLinkTarget(null); setSelectedKey(null); onLinked(targetDeviceId); }}
                />
            )}
        </div>
    );
}
```

Notes on the two deliberate choices there:
- The footer keeps `ports.length` as its denominator (spec §9: a configured faceplate with no documented ports reads `0/0 Linked`). The faceplate itself still renders every declared slot.
- The `selectedSlot?.port &&` guard makes the empty-slot case structurally impossible to open a panel; the `role`/`tabIndex`/`onKeyDown` omission makes it structurally unreachable by keyboard.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run components/rack3d/device-hologram.test.tsx --exclude "**/.kilo/**"`
Expected: PASS, 10 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` (expect the Task 2 call-site failure in `rack-scene.tsx` only) and `npx eslint components/rack3d/device-hologram.tsx components/rack3d/device-hologram.test.tsx`
Expected: no lint errors. In particular no `react-hooks/set-state-in-effect`: the seam props are render-time reads, not effects.

- [ ] **Step 7: Commit**

```bash
git add components/rack3d/device-hologram.tsx components/rack3d/device-hologram.test.tsx
git commit -m "feat(rack3d): hologram pakai faceplate, strip hover + panel info slot"
```

---

### Task 4: The other-room peer card

**Files:**
- Create: `components/rack3d/peer-rack-mini.tsx`
- Create: `components/rack3d/peer-rack-card.tsx`
- Create: `components/rack3d/peer-rack-card.test.tsx`

**Interfaces:**
- Consumes: `RackDevice` (`@/actions/rack-layout`), `SceneRack` (`@/lib/rack-filter`), constants from `./constants`, `inRack` from `./free-slots`.
- Produces:
  - `default export function PeerRackMini({ devices, totalU, peerId }: { devices: RackDevice[]; totalU: number; peerId: number })` — R3F only, never imported by a test.
  - `export function PeerRackCard({ rack, peer, portName, onMove, onClose }: { rack: SceneRack; peer: RackDevice; portName: string | null; onMove: () => void; onClose: () => void })`

- [ ] **Step 1: Write the failing test**

`components/rack3d/peer-rack-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// The card loads the R3F mini through next/dynamic; the node test environment
// has no WebGL, so the dynamic component is replaced with a stub. This is the
// whole reason peer-rack-mini.tsx is a separate file.
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="peer-mini" /> }));

import { PeerRackCard } from "./peer-rack-card";

const peer = {
    id: 42, name: "SW-9", rackPosition: 12, uHeight: 1, categoryColor: "#3b82f6",
} as never;

const rack = {
    name: "R2", totalU: 42, devices: [peer], locationName: "Room B",
} as never;

describe("PeerRackCard", () => {
    it("names the room, rack and unit of the peer", () => {
        const html = renderToStaticMarkup(<PeerRackCard rack={rack} peer={peer} portName="5" onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Room B");
        expect(html).toContain("R2");
        expect(html).toContain("U12");
        expect(html).toContain("SW-9");
    });

    it("labels the destination port and both actions", () => {
        const html = renderToStaticMarkup(<PeerRackCard rack={rack} peer={peer} portName="5" onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Port 5");
        expect(html).toContain("Move to location");
        expect(html).toContain("Close peer rack card");
    });

    it("reads as unassigned when the rack hangs off no location", () => {
        const loose = { ...(rack as object), locationName: null } as never;
        const html = renderToStaticMarkup(<PeerRackCard rack={loose} peer={peer} portName={null} onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Unassigned Location");
        expect(html).not.toContain("null");
    });

    it("falls back to a generic port label when the port is unknown", () => {
        const html = renderToStaticMarkup(<PeerRackCard rack={rack} peer={peer} portName={null} onMove={() => {}} onClose={() => {}} />);
        expect(html).toContain("Peer port");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/rack3d/peer-rack-card.test.tsx --exclude "**/.kilo/**"`
Expected: FAIL — `Failed to resolve import "./peer-rack-card"`.

- [ ] **Step 3: Write the mini**

`components/rack3d/peer-rack-mini.tsx`:

```tsx
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
```

- [ ] **Step 4: Write the card**

`components/rack3d/peer-rack-card.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { ExternalLink, X } from "lucide-react";
import type { RackDevice } from "@/actions/rack-layout";
import type { SceneRack } from "@/lib/rack-filter";

// Same lazy pattern as the main scene in rack-view-3d.tsx: three.js never loads
// on the server, and the DOM shell below stays testable in the node env.
const PeerRackMini = dynamic(() => import("./peer-rack-mini"), {
    ssr: false,
    loading: () => <div className="grid h-32 place-items-center text-xs text-ops-muted">Loading rack…</div>,
});

const UNASSIGNED = "Unassigned Location";

// The peer lives in another room, so it cannot show up in this scene. Instead
// of a fly-to that would lose the device the user came from, the rack gets a
// small model in the same view; only the button moves the camera.
export function PeerRackCard({ rack, peer, portName, onMove, onClose }: {
    rack: SceneRack;
    peer: RackDevice;
    portName: string | null;
    onMove: () => void;
    onClose: () => void;
}) {
    return (
        <div className="absolute bottom-14 left-3 z-20 w-[260px] overflow-hidden rounded-xl border border-ops-accent/40 bg-ops-surface/95 shadow-lg backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                <p className="truncate text-xs font-semibold text-ops-text">
                    {rack.locationName || UNASSIGNED} · {rack.name} · U{peer.rackPosition ?? "—"}
                </p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close peer rack card"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
                >
                    <X className="size-3.5" />
                </button>
            </div>
            <div className="h-32 bg-ops-bg">
                <PeerRackMini devices={rack.devices} totalU={rack.totalU || 42} peerId={peer.id} />
            </div>
            <div className="space-y-1 border-t border-ops-border px-3 py-2">
                <p className="truncate text-xs font-semibold text-ops-text">{peer.name}</p>
                <p className="truncate text-[11px] text-ops-muted">{portName ? `Port ${portName}` : "Peer port"}</p>
                <button
                    type="button"
                    onClick={onMove}
                    className="flex w-full items-center justify-center gap-1 rounded-md bg-ops-accent px-2 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                    <ExternalLink className="size-3" /> Move to location
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run components/rack3d/peer-rack-card.test.tsx --exclude "**/.kilo/**"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` (expect only the `rack-scene.tsx` call-site failure) and `npx eslint components/rack3d/peer-rack-mini.tsx components/rack3d/peer-rack-card.tsx components/rack3d/peer-rack-card.test.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/rack3d/peer-rack-mini.tsx components/rack3d/peer-rack-card.tsx components/rack3d/peer-rack-card.test.tsx
git commit -m "feat(rack3d): kartu 3D rack peer untuk device di room lain"
```

---

### Task 5: Wire the scene — peer id, stagger, panel keyed to a device

**Files:**
- Modify: `components/rack3d/rack-cabinet.tsx:118-181`
- Modify: `components/rack3d/rack-scene.tsx:23-38, 239-289`
- Modify: `components/rack3d/rack-view-3d.tsx`

**Interfaces:**
- Consumes: `hologramStagger` + `HologramAnchor` (Task 1), `buildCables(placed, (number | null)[])` (Task 2), `DeviceHologram` with `onPickPort?` / `offsetY` (Task 3), `PeerRackCard` (Task 4).
- Produces: no new exports; `RackScene` gains the optional prop `peerDeviceId?: number | null`.

- [ ] **Step 1: Widen the cabinet gate**

In `components/rack3d/rack-cabinet.tsx`, add `peerDeviceId: number | null` to the prop type (next to `selectedDeviceId`) and destructure it, then replace line 180:

```tsx
            {devices.map((d) => {
                const floats = d.id === selectedDeviceId || d.id === peerDeviceId;
                return (
                    <RackDevice
                        key={d.id}
                        device={d}
                        selected={d.id === selectedDeviceId}
                        faded={faded}
                        accent={accent}
                        colorBy={colorBy}
                        onSelect={onSelectDevice}
                        floatCard={floats ? floatCard?.(d) : undefined}
                    />
                );
            })}
```

`selected` stays a single-device flag, so only the clicked device slides out on its rails; the peer just gets the card.

- [ ] **Step 2: Pass the peer through the scene, and watch it for cables**

In `components/rack3d/rack-scene.tsx`:

1. Add to `RackSceneProps`:

```tsx
    peerDeviceId?: number | null;
```

2. Add `peerDeviceId = null` to the destructured props of the default export.
3. Replace line 253:

```tsx
    // Both watched devices keep their rows and their peer racks in the scene: a
    // same-room peer in another rack would otherwise be dropped while a rack is
    // focused, and the peer hologram would have no device to sit on.
    const { peerRacks } = useMemo(
        () => buildCables(placed, [selectedDeviceId, peerDeviceId]),
        [placed, selectedDeviceId, peerDeviceId],
    );
```

4. Pass the prop to `RackCabinet` (after `selectedDeviceId={selectedDeviceId}`):

```tsx
                    peerDeviceId={peerDeviceId}
```

- [ ] **Step 3: Rewrite the peer state and hologram wiring in `RackView3D`**

In `components/rack3d/rack-view-3d.tsx`:

1. Extend the imports:

```tsx
import { DeviceHologram, type FloatPort, type HologramDeviceOption } from "./device-hologram";
import { hologramStagger } from "./hologram-offset";
import { PeerRackCard } from "./peer-rack-card";
```

2. Replace the panel block (current lines 111-116) with:

```tsx
    // Picking a different device (or clearing) starts with the hologram only;
    // the docked panel is reopened deliberately per selection. The panel is
    // keyed to a device id, so the peer hologram's Panel button can dock the
    // peer without hijacking the selection (which would move the camera).
    const [panelFor, setPanelFor] = useState<number | null>(null);
    const [appliedPanelSel, setAppliedPanelSel] = useState<number | null>(null);
    if (selectedDeviceId !== appliedPanelSel) {
        setAppliedPanelSel(selectedDeviceId);
        if (panelFor !== null && panelFor !== selectedDeviceId) setPanelFor(null);
    }
    const setPanelOpenState = (open: boolean) => setPanelFor(open ? selectedDeviceId : null);
    const panelOpen = panelFor !== null;
```

3. Above the `cardDevice` line (current line 120), flatten the device list once — both the peer lookup and the docked panel need it:

```tsx
    const allDevices = useMemo(() => racks.flatMap((r) => r.devices), [racks]);
    const cardDevice = selectedDeviceId == null ? null : allDevices.find((d) => d.id === selectedDeviceId) ?? null;
    const cardDeviceId = cardDevice?.id ?? null;
```

(That replaces the current `racks.flatMap(...).find(...)` one-liner with the same result through the new memo.)

4. After the `cardDeviceId` line, add the peer state and its derivation:

```tsx
    // The peer currently shown: a second hologram when it sits in this room, a
    // 3D rack card when it does not. `peerPickedRoom` is what lets the card
    // survive until the user changes room.
    const [peerDeviceId, setPeerDeviceId] = useState<number | null>(null);
    const [peerPickedRoom, setPeerPickedRoom] = useState<string | null>(null);
    const [peerPorts, setPeerPorts] = useState<FloatPort[]>([]);
    const [peerLoading, setPeerLoading] = useState(false);

    const peerDevice = peerDeviceId == null ? null : allDevices.find((d) => d.id === peerDeviceId) ?? null;
    const peerRack = peerDevice == null ? null : racks.find((r) => r.devices.some((d) => d.id === peerDevice.id)) ?? null;
    const peerInRoom = peerRack != null && (peerRack.locationName || UNASSIGNED) === room;
    const peerCardRack = peerRack != null && !peerInRoom ? peerRack : null;
    const peerPortName = peerDeviceId == null ? null : cardPorts.find((p) => p.connectedToDeviceId === peerDeviceId)?.connectedToPortName ?? null;

    // Render-time resets, the pattern this repo uses instead of an effect the
    // lint rule rejects: the peer must not outlive its room, its base device or
    // its own identity.
    if (peerDeviceId !== null && peerPickedRoom !== room) setPeerDeviceId(null);
    if (peerDeviceId !== null && selectedDeviceId === null) setPeerDeviceId(null);
    if (peerDeviceId !== null && peerDeviceId === selectedDeviceId) setPeerDeviceId(null);

    const stagger = useMemo(() => {
        if (!peerInRoom || !cardDevice || !peerDevice) return { base: 0, peer: 0 };
        // Inlined rather than a helper so the dependency array stays honest.
        return hologramStagger(
            { locationName: cardDevice.locationName, rackName: cardDevice.rackName, u: cardDevice.rackPosition },
            { locationName: peerDevice.locationName, rackName: peerDevice.rackName, u: peerDevice.rackPosition },
        );
    }, [peerInRoom, cardDevice, peerDevice]);
```

5. Add the peer ports fetch, right after the existing `cardDeviceId` effect (current lines 122-131) so the two read the same way:

```tsx
    const peerFetchId = peerInRoom && peerDevice ? peerDevice.id : null;
    useEffect(() => {
        if (peerFetchId == null) return;
        let alive = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch result for the peer device, guarded by alive + id match
        setPeerLoading(true);
        getPortsByDevice(peerFetchId)
            .then((ports) => { if (alive) { setPeerPorts(ports); setPeerLoading(false); } })
            .catch(() => { if (alive) { setPeerPorts([]); setPeerLoading(false); } });
        return () => { alive = false; };
    }, [peerFetchId]);
```

6. Replace the whole `floatCard` arrow function (current lines 352-388) with:

```tsx
                    floatCard={(dev) => {
                        const isPeer = dev.id === peerDeviceId;
                        const isBase = dev.id === cardDeviceId;
                        return (
                            <DeviceHologram
                                device={dev}
                                ports={isBase ? cardPorts : isPeer ? peerPorts : []}
                                loading={isBase ? cardLoading : isPeer ? peerLoading : false}
                                deviceOptions={deviceOptions}
                                offsetY={isPeer ? stagger.peer : stagger.base}
                                onClose={() => { if (isPeer) setPeerDeviceId(null); else onSelectDevice(null); }}
                                // Only the base hologram may guide movement, so the
                                // peer cannot spawn a third card.
                                onPickPort={isPeer ? undefined : (p) => {
                                    const peerId = p.connectedToDeviceId;
                                    if (peerId == null || peerId === selectedDeviceId) return;
                                    const hit = racks.find((r) => r.devices.some((d) => d.id === peerId));
                                    const found = hit?.devices.find((d) => d.id === peerId);
                                    if (!hit || !found) {
                                        // Not racked in this site: the peer's docs are
                                        // the only place that can show it.
                                        router.push(`/admin/devices/${peerId}/network`);
                                        return;
                                    }
                                    setPeerDeviceId(found.id);
                                    setPeerPickedRoom(room);
                                }}
                                onLinked={(targetDeviceId) => {
                                    const hit = racks.find((r) => r.devices.some((d) => d.id === targetDeviceId));
                                    const found = hit?.devices.find((d) => d.id === targetDeviceId);
                                    if (!found || !hit) {
                                        router.push(`/admin/devices/${targetDeviceId}/network`);
                                        return;
                                    }
                                    if (isPeer) {
                                        // Linking from the peer keeps the camera put:
                                        // only swap which device the second card shows.
                                        if (found.id !== selectedDeviceId && (hit.locationName || UNASSIGNED) === room) setPeerDeviceId(found.id);
                                        return;
                                    }
                                    setRoomPick(hit.locationName || UNASSIGNED);
                                    setFocusPick(hit.name);
                                    onSelectDevice(found);
                                }}
                                onOpenPanel={() => setPanelFor(dev.id)}
                            />
                        );
                    }}
```

7. Replace the panel render (current lines 391-398) with:

```tsx
                {panelDevice && panelOpen && (
                    <DeviceDetailPanel
                        docked
                        device={panelDevice}
                        onClose={() => setPanelOpenState(false)}
                        onSelectPeer={onSelectPeer}
                    />
                )}
                {peerCardRack && peerDevice && (
                    <PeerRackCard
                        rack={peerCardRack}
                        peer={peerDevice}
                        portName={peerPortName}
                        onMove={() => {
                            setRoomPick(peerCardRack.locationName || UNASSIGNED);
                            setFocusPick(peerCardRack.name);
                            onSelectDevice(peerDevice);
                        }}
                        onClose={() => setPeerDeviceId(null)}
                    />
                )}
```

and add `panelDevice` next to `cardDevice` (current line 120):

```tsx
    const panelDevice = panelFor == null ? null : allDevices.find((d) => d.id === panelFor) ?? null;
```

`allDevices` is defined above it in step 3, before `cardDevice` — no forward reference.

8. Pass the peer to the scene, next to `selectedDeviceId={selectedDeviceId}`:

```tsx
                    peerDeviceId={peerInRoom ? peerDeviceId : null}
```

The scene only needs the peer id when it is drawn as a hologram; the other-room case is the card, which reads `racks` directly.

- [ ] **Step 4: Verify the whole gate**

Run: `npm run test`, then `npm run typecheck`, then `npm run lint`
Expected: `npm run test` green (the Task 2 call-site error is gone — that is what this task fixes). `npm run typecheck` clean. `npm run lint` reports 0 errors outside `.kilo/` — the 4 `no-require-imports` errors all live in the `.kilo/worktrees/` duplicate and are pre-existing; verify with `npx eslint --ignore-pattern ".kilo/**"`.

- [ ] **Step 5: Browser check (no automated harness for `RackView3D`)**

Run: `npm run dev`, open the 3D rack view, and confirm each of these by hand — they are the wiring that no test in this repo can reach:

1. Click a device whose port is wired to a device **in the same room, another rack**: two holograms appear, staggered apart, and the camera does **not** move.
2. Click a device wired to a device in **another room**: the peer rack card appears bottom-left with the rack model; the camera does not move. Clicking **Move to location** switches room and selects the peer.
3. With a peer card open, click a different **room tab**: the card disappears.
4. Press **Escape** (and click empty space in the scene) with two holograms up: both disappear.
5. Hover slot 3 on a switch with more declared slots than documented ports: the strip says the slot is empty and never mentions provisioning.
6. Click an occupied slot: the detail panel opens over the faceplate with **Tutup** and **Edit link**; **Edit link** opens the link dialog for that port.
7. Click the **Panel** button on the peer hologram: the docked panel shows the **peer**, and the camera stays where it is.
8. Save a link from the peer hologram to a third device in the same room: the second card swaps to that device and **no third hologram** appears.

- [ ] **Step 6: Commit**

```bash
git add components/rack3d/rack-cabinet.tsx components/rack3d/rack-scene.tsx components/rack3d/rack-view-3d.tsx
git commit -m "feat(rack3d): hologram peer sekamar + kartu rack room lain tanpa fly-to"
```
