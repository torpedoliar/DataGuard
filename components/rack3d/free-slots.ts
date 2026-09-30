export interface SlotDevice { rackPosition: number | null; uHeight: number | null }
export interface FreeRange { start: number; size: number }

export const inRack = (d: SlotDevice, totalU: number) =>
    !!d.rackPosition && d.rackPosition >= 1 && d.rackPosition + (d.uHeight || 1) - 1 <= totalU;

export function freeRanges(totalU: number, devices: SlotDevice[]): FreeRange[] {
    const used = new Array<boolean>(totalU + 1).fill(false);
    for (const d of devices) {
        if (!d.rackPosition) continue;
        for (let u = d.rackPosition; u < d.rackPosition + (d.uHeight || 1); u++) {
            if (u >= 1 && u <= totalU) used[u] = true;
        }
    }
    const out: FreeRange[] = [];
    for (let u = 1; u <= totalU; u++) {
        if (used[u]) continue;
        const last = out.at(-1);
        if (last && last.start + last.size === u) last.size++;
        else out.push({ start: u, size: 1 });
    }
    return out;
}
