import { RACK_D, RACK_W, ROOM_MARGIN, ROW_PITCH, SLOT_PITCH, TILE } from "./constants";

export interface LayoutRack {
    name: string;
    floorRow: string | null;
    floorSlot: number | null;
    facing: string | null;
}

export interface PlacedRack<R extends LayoutRack = LayoutRack> {
    rack: R;
    row: string;
    slot: number;
    x: number;
    z: number;
    rotationY: number;
    collision: boolean;
    unplaced: boolean;
}

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export const UNPLACED_ROW = "Unplaced";

const naturally = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// Row key as stored by the rack action (trim + uppercase); applied here too
// so rows written any other way (import, SQL) still merge.
const rowKey = (row: string | null) => row?.trim().toUpperCase() || null;

// Grid placement: row -> z, slot -> x. Racks without a row go to one auto
// row (or an "Unplaced" row behind the real ones). Every rack with a unique
// explicit slot keeps it; only the later duplicates of a slot (and racks
// with no slot) are fitted into the free slots after the row's last slot.
// Duplicates are flagged so the UI can warn.
export function layoutRacks<R extends LayoutRack>(racks: R[]): PlacedRack<R>[] {
    const rows = new Map<string, R[]>();
    const ordered = racks
        .filter((r) => rowKey(r.floorRow))
        .sort((a, b) => (a.floorSlot ?? Infinity) - (b.floorSlot ?? Infinity) || naturally(a.name, b.name));
    for (const r of ordered) {
        const key = rowKey(r.floorRow)!;
        rows.set(key, [...(rows.get(key) ?? []), r]);
    }

    const rowNames = [...rows.keys()].sort(naturally);
    const out: PlacedRack<R>[] = [];

    rowNames.forEach((row, rowIndex) => {
        const taken = new Set<number>();
        const deferred: { rack: R; collision: boolean }[] = [];
        for (const rack of rows.get(row)!) {
            if (rack.floorSlot != null && !taken.has(rack.floorSlot)) {
                taken.add(rack.floorSlot);
                out.push(place(rack, row, rowIndex, rack.floorSlot, false));
            } else {
                deferred.push({ rack, collision: rack.floorSlot != null });
            }
        }
        for (const { rack, collision } of deferred) {
            let slot = Math.max(0, ...taken) + 1;
            while (taken.has(slot)) slot++;
            taken.add(slot);
            out.push(place(rack, row, rowIndex, slot, collision));
        }
    });

    const unplacedRow = rowNames.length ? UNPLACED_ROW : "";
    racks
        .filter((r) => !rowKey(r.floorRow))
        .sort((a, b) => naturally(a.name, b.name))
        .forEach((rack, i) => out.push(place(rack, unplacedRow, rowNames.length, i + 1, false)));

    return centre(out);
}

function place<R extends LayoutRack>(rack: R, row: string, rowIndex: number, slot: number, collision: boolean): PlacedRack<R> {
    return {
        rack, row, slot, collision,
        unplaced: !rowKey(rack.floorRow),
        x: (slot - 1) * SLOT_PITCH,
        z: rowIndex * ROW_PITCH,
        rotationY: rack.facing === "back" ? Math.PI : 0,
    };
}

function centre<R extends LayoutRack>(list: PlacedRack<R>[]): PlacedRack<R>[] {
    if (!list.length) return list;
    const b = bounds(list);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    return list.map((p) => ({ ...p, x: p.x - cx, z: p.z - cz }));
}

export function bounds(list: PlacedRack[]): Bounds {
    if (!list.length) return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const xs = list.map((p) => p.x);
    const zs = list.map((p) => p.z);
    return {
        minX: Math.min(...xs) - RACK_W / 2,
        maxX: Math.max(...xs) + RACK_W / 2,
        minZ: Math.min(...zs) - RACK_D / 2,
        maxZ: Math.max(...zs) + RACK_D / 2,
    };
}

export const tileKey = (x: number, z: number) => `${Math.round(x / TILE) || 0},${Math.round(z / TILE) || 0}`;

// Perforated tile in front of every door = the cold aisle.
export function coldAisleTiles(list: PlacedRack[]): Set<string> {
    const set = new Set<string>();
    for (const p of list) {
        const dir = p.rotationY === 0 ? 1 : -1;
        set.add(tileKey(p.x, p.z + dir * (RACK_D / 2 + TILE / 2)));
    }
    return set;
}

// Room walls snapped to tile edges (tile centres sit on multiples of TILE).
export function roomRect(b: Bounds, margin = ROOM_MARGIN) {
    const lo = (v: number) => (Math.floor(v / TILE + 0.5) - 0.5) * TILE;
    const hi = (v: number) => (Math.ceil(v / TILE - 0.5) + 0.5) * TILE;
    return { x0: lo(b.minX - margin), x1: hi(b.maxX + margin), z0: lo(b.minZ - margin), z1: hi(b.maxZ + margin) };
}

// Floor-plan image placement: keep the image aspect and make the padded rack
// bounds fit inside it.
export function floorPlanRect(b: Bounds, aspect: number, margin = 1) {
    const w = b.maxX - b.minX + margin * 2;
    const d = b.maxZ - b.minZ + margin * 2;
    const width = Math.max(w, d * aspect);
    return { width, depth: width / aspect, cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2 };
}
