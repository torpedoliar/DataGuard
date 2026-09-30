import type { RackData, RackDevice } from "@/actions/rack-layout";

export interface RackFilters {
    search: string;
    zone: string;
    category: string;
    status: string;
    location: string;
}

export const EMPTY_FILTERS: RackFilters = { search: "", zone: "", category: "", status: "", location: "" };

export type FilteredDevice = RackDevice & { isMuted: boolean };
export type FilteredRack = Omit<RackData, "devices"> & { devices: FilteredDevice[]; hasMatchingDevices: boolean };
export type SceneRack = FilteredRack & { dimmed: boolean };

export const hasActiveFilters = (f: RackFilters) => Object.values(f).some(Boolean);

// Shared by the 2D grid and the 3D scene so both views agree on what matches.
export function applyRackFilters(racks: RackData[], f: RackFilters): FilteredRack[] {
    const q = f.search.toLowerCase();
    const active = hasActiveFilters(f);
    const muting = !!(f.search || f.category || f.status || f.zone);

    return racks.flatMap((rack) => {
        const devices = rack.devices.map((device) => {
            const matchesSearch = !q || device.name.toLowerCase().includes(q) || !!device.brandName?.toLowerCase().includes(q);
            const isMatch = matchesSearch
                && (!f.category || device.categoryName === f.category)
                && (!f.status || device.status === f.status);
            return { ...device, isMuted: !isMatch && muting };
        });
        const hasMatchingDevices = devices.some((d) => !d.isMuted);
        const show = !active || (
            (!f.zone || rack.zone === f.zone)
            && (!f.location || rack.locationName === f.location)
            && (!q || rack.name.toLowerCase().includes(q) || hasMatchingDevices)
        );
        return show ? [{ ...rack, devices, hasMatchingDevices }] : [];
    });
}

// 3D keeps every rack in place (the room must not reshuffle while filtering);
// racks the 2D view would hide are dimmed instead.
export function applyRackFiltersForScene(racks: RackData[], f: RackFilters): SceneRack[] {
    const shown = new Map(applyRackFilters(racks, f).map((r) => [r.name, r]));
    return racks.map((r) => {
        const hit = shown.get(r.name);
        return hit
            ? { ...hit, dimmed: false }
            : { ...r, devices: r.devices.map((d) => ({ ...d, isMuted: true })), hasMatchingDevices: false, dimmed: true };
    });
}

export function singleMatchId(racks: FilteredRack[], f: RackFilters): number | null {
    if (!hasActiveFilters(f)) return null;
    const matches = racks.flatMap((r) => r.devices.filter((d) => !d.isMuted));
    return matches.length === 1 ? matches[0].id : null;
}
