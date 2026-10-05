"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Server } from "lucide-react";
import type { RackData, RackDevice, RoomSettings } from "@/actions/rack-layout";
import RackLayout from "@/components/admin/rack-layout";
import RackFilterBar, { type RackView } from "@/components/admin/rack-filter-bar";
import DeviceDetailPanel from "@/components/admin/device-detail-panel";
import RackView3D from "@/components/rack3d/rack-view-3d";
import RoomLayoutEditor, { FloorPlacementPreview, type LayoutAsset } from "./room-layout-editor";
import { facilityDimensions } from "@/lib/facility-asset";
import { RACK_W, RACK_D, rackHeight } from "@/components/rack3d/constants";
import { facilityLabel } from "@/lib/facility-asset";
import { applyRackFilters, applyRackFiltersForScene, EMPTY_FILTERS, hasActiveFilters, singleMatchId, type RackFilters } from "@/lib/rack-filter";

const VIEW_KEY = "rack-layout-view";

interface RackLayoutShellProps {
    facilities?: RackDevice[];
    racks: RackData[];
    categories: { id: number; name: string; color: string | null }[];
    rooms: Record<number, RoomSettings>;
    canEditAppearance: boolean;
    siteName: string;
}

export default function RackLayoutShell({ racks, facilities = [], categories, rooms, canEditAppearance, siteName }: RackLayoutShellProps) {
    const [layoutRoom, setLayoutRoom] = useState<number | null>(null);
    const [filters, setFilters] = useState<RackFilters>(EMPTY_FILTERS);
    const [selected, setSelected] = useState<RackDevice | null>(null);
    const [view, setView] = useState<RackView>("2d");
    const [noWebgl, setNoWebgl] = useState(false);
    const filtered = useMemo(() => applyRackFilters(racks, filters), [racks, filters]);
    const sceneRacks = useMemo(() => applyRackFiltersForScene(racks, filters), [racks, filters]);
    const allDevices = useMemo(() => [...racks.flatMap((r) => r.devices), ...facilities], [racks, facilities]);
    const filteredFacilities = facilities.filter((d) => (!filters.search || `${d.name} ${d.brandName ?? ""}`.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.category || d.categoryName === filters.category) && (!filters.status || d.status === filters.status) && (!filters.location || d.locationName === filters.location) && (!filters.zone || d.zone === filters.zone));
    // Drawer connection click: select the peer if it is racked on this site.
    const selectPeer = useCallback((id: number) => {
        const peer = allDevices.find((d) => d.id === id);
        if (peer) setSelected(peer);
        return !!peer;
    }, [allDevices]);

    useEffect(() => {
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the last chosen view after hydration (SSR always renders 2D)
            if (localStorage.getItem(VIEW_KEY) === "3d") setView("3d");
        } catch { /* storage blocked */ }
    }, []);

    const changeView = (v: RackView) => {
        setView(v);
        try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
    };
    const onWebglUnavailable = useCallback(() => {
        setNoWebgl(true);
        setView("2d");
    }, []);

    if (racks.length === 0 && facilities.length === 0 && Object.keys(rooms).length === 0) {
        return (
            <div className="text-center py-12 text-ops-muted">
                <Server className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-ops-text">No rack data available</p>
                <p className="text-sm mt-2">Add devices with rack positions to see the layout</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {canEditAppearance && <div className="flex flex-wrap gap-2">{Object.entries(rooms).map(([id, room]) => <button type="button" key={id} className="rounded border border-ops-border px-3 py-2 text-sm" onClick={() => setLayoutRoom(Number(id))}>Atur Layout · {room.name ?? `Room ${id}`}</button>)}</div>}
            {layoutRoom !== null && <RoomLayoutEditor roomId={layoutRoom} onClose={() => setLayoutRoom(null)} />}
            <RackFilterBar
                facilities={facilities}
                racks={racks}
                categories={categories}
                filters={filters}
                onChange={setFilters}
                view={view}
                onViewChange={changeView}
                disable3d={noWebgl}
            />

            <div className="rounded-xl border border-ops-border bg-ops-surface shadow-sm p-4">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {categories.map((cat) => (
                        <div key={cat.id} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm shadow-sm ring-1 ring-black/5" style={{ backgroundColor: cat.color || "#3b82f6" }} />
                            <span className="text-xs text-ops-muted">{cat.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {noWebgl && (
                <p className="rounded-lg border border-ops-border bg-ops-surface px-4 py-2 text-sm text-ops-muted">
                    3D view needs WebGL, which this browser does not provide. Showing the 2D layout.
                </p>
            )}

            {filteredFacilities.length > 0 && <section className="space-y-2"><h2 className="font-semibold">Cooling / Power</h2><div className="flex flex-wrap gap-2">{filteredFacilities.map((d) => <button type="button" key={d.id} onClick={() => setSelected(d)} className="rounded border border-ops-border bg-ops-surface px-3 py-2 text-left text-sm"><span className="block font-semibold">{d.name}</span><span className="text-xs text-ops-muted">{facilityLabel(d.assetType!, d.facilitySpecs)} · {d.locationName ?? "Unassigned"} · {d.floorX == null ? "Unplaced" : `X ${d.floorX} / Z ${d.floorZ} m`}</span></button>)}</div></section>}
            {view !== "3d" && Object.entries(rooms).filter(([, room]) => room.layoutMode === "manual").map(([id, room]) => {
                const assets: LayoutAsset[] = [...racks.filter((r) => r.locationId === Number(id)).map((r) => ({ key: `rack:${r.id}`, name: r.name, kind: "rack" as const, x: r.floorX ?? null, z: r.floorZ ?? null, rotation: r.floorRotation ?? null, width: RACK_W, depth: RACK_D, height: rackHeight(r.totalU), estimated: true })), ...facilities.filter((d) => d.locationId === Number(id)).map((d) => ({ key: `device:${d.id}`, name: d.name, kind: d.assetType ?? "standard", x: d.floorX ?? null, z: d.floorZ ?? null, rotation: d.floorRotation ?? null, ...facilityDimensions({ assetType: d.assetType!, facilitySpecs: d.facilitySpecs ?? null }) }))];
                return <section key={id} className="rounded border border-ops-border p-4"><h2 className="mb-2 font-semibold">Denah · {room.name ?? id}</h2><FloorPlacementPreview assets={assets} width={room.roomWidthM ?? 10} depth={room.roomDepthM ?? 8} floorPlanPath={room.floorPlanPath} /></section>;
            })}
            {view !== "3d" && (
                <DeviceDetailPanel device={selected} onClose={() => setSelected(null)} onSelectPeer={selectPeer} />
            )}

            {view === "3d" ? (
                <RackView3D
                    facilities={facilities.map((device) => ({ ...device, isMuted: !filteredFacilities.some((d) => d.id === device.id) }))}
                    racks={sceneRacks}
                    locationFilter={filters.location || null}
                    rooms={rooms}
                    canEditAppearance={canEditAppearance}
                    siteName={siteName}
                    selectedDeviceId={selected?.id ?? null}
                    autoFocusDeviceId={hasActiveFilters(filters) && filteredFacilities.length === 1 && filtered.flatMap((r) => r.devices.filter((d) => !d.isMuted)).length === 0 ? filteredFacilities[0].id : filteredFacilities.length === 0 ? singleMatchId(filtered, filters) : null}
                    onSelectDevice={setSelected}
                    onSelectPeer={selectPeer}
                    onWebglUnavailable={onWebglUnavailable}
                />
            ) : (
                <div className="overflow-x-auto">
                    <RackLayout
                        racks={filtered}
                        hasFilters={hasActiveFilters(filters)}
                        onResetFilters={() => setFilters(EMPTY_FILTERS)}
                        onSelectDevice={setSelected}
                    />
                </div>
            )}
        </div>
    );
}
