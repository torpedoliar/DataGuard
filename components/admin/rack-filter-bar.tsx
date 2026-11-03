"use client";

import { Box, Filter, LayoutGrid, Search, X } from "lucide-react";
import type { RackData } from "@/actions/rack-layout";
import { EMPTY_FILTERS, hasActiveFilters, type RackFilters } from "@/lib/rack-filter";

export type RackView = "2d" | "3d";

interface RackFilterBarProps {
    racks: RackData[];
    facilities?: { zone: string | null; locationName: string | null }[];
    categories: { id: number; name: string; color: string | null }[];
    filters: RackFilters;
    onChange: (filters: RackFilters) => void;
    view?: RackView;
    onViewChange?: (view: RackView) => void;
    disable3d?: boolean;
}

const selectClass = "ops-input h-9 min-w-[120px] px-3 text-sm";

export default function RackFilterBar({ racks, facilities = [], categories, filters, onChange, view, onViewChange, disable3d }: RackFilterBarProps) {
    const zones = Array.from(new Set([...racks, ...facilities].map((r) => r.zone).filter((z): z is string => !!z))).sort();
    const locations = Array.from(new Set([...racks, ...facilities].map((r) => r.locationName).filter((l): l is string => !!l))).sort();
    const set = (patch: Partial<RackFilters>) => onChange({ ...filters, ...patch });

    return (
        <div className="ops-panel flex flex-col items-start gap-3 p-3 xl:flex-row xl:items-center">
            <div className="relative flex-1 w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input
                    type="text"
                    placeholder="Search device, brand, or rack…"
                    value={filters.search}
                    onChange={(e) => set({ search: e.target.value })}
                    className={`${selectClass} w-full pl-9 pr-8`}
                />
                {filters.search && (
                    <button onClick={() => set({ search: "" })} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm text-ops-muted transition-colors hover:text-ops-text">
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            <div className="flex w-full xl:w-auto gap-2 overflow-x-auto pb-1 xl:pb-0 items-center no-scrollbar">
                <div className="flex items-center gap-1.5 text-ops-muted text-xs whitespace-nowrap shrink-0">
                    <Filter className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Filter:</span>
                </div>
                <select value={filters.zone} onChange={(e) => set({ zone: e.target.value })} className={selectClass}>
                    <option value="">All Zones</option>
                    {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
                <select value={filters.location} onChange={(e) => set({ location: e.target.value })} className={selectClass}>
                    <option value="">All Locations</option>
                    {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <select value={filters.category} onChange={(e) => set({ category: e.target.value })} className={selectClass}>
                    <option value="">All Categories</option>
                    {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className={`${selectClass} min-w-[110px]`}>
                    <option value="">All Status</option>
                    <option value="OK">OK</option>
                    <option value="NOT OK">NOT OK</option>
                    <option value="Pending">Pending</option>
                </select>
                {hasActiveFilters(filters) && (
                    <button onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-ops-border-strong bg-ops-surface px-3 text-[13px] font-medium text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text">
                        <X className="h-3 w-3" /> Reset
                    </button>
                )}
                {view && onViewChange && (
                    <div role="group" aria-label="Layout view" className="flex shrink-0 rounded-md border border-ops-border bg-ops-surface-raised p-0.5">
                        {(["2d", "3d"] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                aria-pressed={view === v}
                                disabled={v === "3d" && disable3d}
                                title={v === "3d" && disable3d ? "WebGL is not available in this browser" : undefined}
                                onClick={() => onViewChange(v)}
                                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                                    view === v ? "bg-ops-accent/15 text-ops-accent" : "text-ops-muted hover:text-ops-text"
                                }`}
                            >
                                {v === "2d" ? <LayoutGrid className="h-4 w-4" /> : <Box className="h-4 w-4" />}
                                {v.toUpperCase()}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
