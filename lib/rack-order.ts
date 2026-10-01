// One rack order for the 2D grid, the 3D room and the reorder action:
// row, then slot, then name.

export interface OrderedRack {
    name: string;
    floorRow: string | null;
    floorSlot: number | null;
}

// A rack's new floor position after a drag-reorder.
export type RackMove = { name: string; floorRow: string | null; floorSlot: number };

export const naturally = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// Row key as stored by the rack action (trim + uppercase); applied on read
// too so rows written any other way (import, SQL) still merge.
export const rowKey = (row: string | null | undefined) => row?.trim().toUpperCase() || null;

export function compareRackOrder(a: OrderedRack, b: OrderedRack) {
    const ra = rowKey(a.floorRow);
    const rb = rowKey(b.floorRow);
    if (ra !== rb) {
        if (ra === null) return 1; // rowless racks after the real rows
        if (rb === null) return -1;
        return naturally(ra, rb);
    }
    return (a.floorSlot ?? Infinity) - (b.floorSlot ?? Infinity) || naturally(a.name, b.name);
}

// Drag `from` onto `to`: `from` joins `to`'s row at `to`'s place (after it
// when moving forward in the same row). Returns the new row/slot for every
// rack whose position changed, slots renumbered 1..n per touched row.
// ponytail: renumbering closes physical gaps in that row; keep gaps by hand
// in the rack form if the room has empty floor positions.
export function moveRack<R extends OrderedRack>(list: R[], from: string, to: string): RackMove[] {
    if (from === to) return [];
    const sorted = [...list].sort(compareRackOrder);
    const src = sorted.find((r) => r.name === from);
    const dst = sorted.find((r) => r.name === to);
    if (!src || !dst) return [];

    const row = (key: string | null) => sorted.filter((r) => rowKey(r.floorRow) === key && r.name !== from);
    const dstKey = rowKey(dst.floorRow);
    const srcKey = rowKey(src.floorRow);
    const target = row(dstKey);
    const sameRow = srcKey === dstKey;
    const forward = sameRow && sorted.indexOf(src) < sorted.indexOf(dst);
    target.splice(target.findIndex((r) => r.name === to) + (forward ? 1 : 0), 0, src);

    const out = new Map<string, RackMove>();
    const renumber = (racks: R[], key: string | null) => racks.forEach((r, i) => {
        if (rowKey(r.floorRow) !== key || r.floorSlot !== i + 1) out.set(r.name, { name: r.name, floorRow: key, floorSlot: i + 1 });
    });
    renumber(target, dstKey);
    if (!sameRow) renumber(row(srcKey), srcKey);
    return [...out.values()];
}
