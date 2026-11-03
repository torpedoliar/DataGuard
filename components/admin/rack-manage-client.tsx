"use client";

import { getRacks } from "@/actions/rack-management";
import AddRackForm from "@/components/admin/add-rack-form";
import RackTable from "@/components/admin/rack-table";
import EditRackForm from "@/components/admin/edit-rack-form";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";
import { Server, LayoutGrid, Shapes } from "lucide-react";
import { useState, useEffect } from "react";

type Rack = {
    id: number;
    name: string;
    zone: string | null;
    totalU: number | null;
    locationId: number | null;
    locationName: string | null;
    isAuditable?: boolean | null;
    floorRow?: string | null;
    floorSlot?: number | null;
    facing?: string | null;
};

type Location = {
    id: number;
    name: string;
};

export default function RackManageClient() {
    const [racks, setRacks] = useState<Rack[]>([]);
    const [locations, setLocations] = useState<Location[]>([]);
    const [editingRack, setEditingRack] = useState<Rack | null>(null);

    useEffect(() => {
        getRacks().then(setRacks);
        import("@/actions/locations").then(m => m.getLocations().then(setLocations));
    }, []);

    const zones = new Set(racks.map(r => r.zone).filter(Boolean)).size;
    const kpis = [
        { label: "Total racks", value: racks.length, icon: Server, tone: "text-ops-info bg-ops-info-soft" },
        { label: "Total capacity", value: `${racks.reduce((sum, r) => sum + (r.totalU || 42), 0)}U`, icon: LayoutGrid, tone: "text-ops-success bg-ops-success-soft" },
        { label: "Zones", value: zones, icon: Shapes, tone: "text-ops-info bg-ops-info-soft" },
    ];

    return (
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Infrastructure"
                title="Rack management"
                description="Define and manage rack definitions for your data center."
                actions={
                    <>
                        <ActionButton href="/admin/rack" variant="secondary" icon={<LayoutGrid className="size-4" />}>
                            View rack layout
                        </ActionButton>
                        <ActionButton href="/admin" variant="secondary" icon={<Server className="size-4" />}>
                            Manage devices
                        </ActionButton>
                    </>
                }
            />

            {/* Stats cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {kpis.map((kpi) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={kpi.label} className="ops-panel flex items-center gap-3 p-4">
                            <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${kpi.tone}`}>
                                <Icon className="size-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[13px] text-ops-muted">{kpi.label}</p>
                                <p className="text-2xl font-semibold tabular-nums leading-tight text-ops-text">{kpi.value}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <AddRackForm
                locations={locations}
                onSuccess={() => getRacks().then(setRacks)}
            />

            <section className="flex flex-col gap-4">
                <div className="flex items-end justify-between gap-3">
                    <div>
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Defined racks</h2>
                        <p className="mt-0.5 text-[13px] text-ops-muted">Capacity, room placement, and audit scope per rack.</p>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-ops-muted">{racks.length} total</span>
                </div>
                <RackTable
                    racks={racks}
                    onEdit={setEditingRack}
                    onDeleteSuccess={() => getRacks().then(setRacks)}
                />
            </section>

            {editingRack && (
                <EditRackForm
                    rack={editingRack}
                    locations={locations}
                    onClose={() => {
                        setEditingRack(null);
                        getRacks().then(setRacks);
                    }}
                />
            )}
        </main>
    );
}
