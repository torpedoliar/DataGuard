"use client";

import { useMemo, useState } from "react";
import { Server } from "lucide-react";
import type { RackData, RackDevice } from "@/actions/rack-layout";
import RackLayout from "@/components/admin/rack-layout";
import RackFilterBar from "@/components/admin/rack-filter-bar";
import DeviceDetailPanel from "@/components/admin/device-detail-panel";
import { applyRackFilters, EMPTY_FILTERS, hasActiveFilters, type RackFilters } from "@/lib/rack-filter";

interface RackLayoutShellProps {
    racks: RackData[];
    categories: { id: number; name: string; color: string | null }[];
}

export default function RackLayoutShell({ racks, categories }: RackLayoutShellProps) {
    const [filters, setFilters] = useState<RackFilters>(EMPTY_FILTERS);
    const [selected, setSelected] = useState<RackDevice | null>(null);
    const filtered = useMemo(() => applyRackFilters(racks, filters), [racks, filters]);

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
            <RackFilterBar racks={racks} categories={categories} filters={filters} onChange={setFilters} />

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

            <DeviceDetailPanel device={selected} onClose={() => setSelected(null)} />

            <div className="overflow-x-auto">
                <RackLayout
                    racks={filtered}
                    hasFilters={hasActiveFilters(filters)}
                    onResetFilters={() => setFilters(EMPTY_FILTERS)}
                    onSelectDevice={setSelected}
                />
            </div>
        </div>
    );
}
