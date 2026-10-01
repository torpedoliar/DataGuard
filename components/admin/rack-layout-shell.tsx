"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Server } from "lucide-react";
import type { RackData, RackDevice, RoomSettings } from "@/actions/rack-layout";
import RackLayout from "@/components/admin/rack-layout";
import RackFilterBar, { type RackView } from "@/components/admin/rack-filter-bar";
import DeviceDetailPanel from "@/components/admin/device-detail-panel";
import RackView3D from "@/components/rack3d/rack-view-3d";
import { applyRackFilters, applyRackFiltersForScene, EMPTY_FILTERS, hasActiveFilters, singleMatchId, type RackFilters } from "@/lib/rack-filter";

const VIEW_KEY = "rack-layout-view";

interface RackLayoutShellProps {
    racks: RackData[];
    categories: { id: number; name: string; color: string | null }[];
    rooms: Record<number, RoomSettings>;
}

export default function RackLayoutShell({ racks, categories, rooms }: RackLayoutShellProps) {
    const [filters, setFilters] = useState<RackFilters>(EMPTY_FILTERS);
    const [selected, setSelected] = useState<RackDevice | null>(null);
    const [view, setView] = useState<RackView>("2d");
    const [noWebgl, setNoWebgl] = useState(false);
    const filtered = useMemo(() => applyRackFilters(racks, filters), [racks, filters]);
    const sceneRacks = useMemo(() => applyRackFiltersForScene(racks, filters), [racks, filters]);
    const allDevices = useMemo(() => racks.flatMap((r) => r.devices), [racks]);
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

    if (racks.length === 0) {
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
            <RackFilterBar
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

            <DeviceDetailPanel device={selected} onClose={() => setSelected(null)} onSelectPeer={selectPeer} />

            {view === "3d" ? (
                <RackView3D
                    racks={sceneRacks}
                    locationFilter={filters.location || null}
                    rooms={rooms}
                    selectedDeviceId={selected?.id ?? null}
                    autoFocusDeviceId={singleMatchId(filtered, filters)}
                    onSelectDevice={setSelected}
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
