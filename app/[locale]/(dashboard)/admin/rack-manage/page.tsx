"use client";

import { getRacks } from "@/actions/rack-management";
import AddRackForm from "@/components/admin/add-rack-form";
import RackTable from "@/components/admin/rack-table";
import EditRackForm from "@/components/admin/edit-rack-form";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Server, Grid3X3 } from "lucide-react";
import { useState, useEffect } from "react";

type Rack = {
    id: number;
    name: string;
    zone: string | null;
    totalU: number | null;
    locationId: number | null;
    locationName: string | null;
};

type Location = {
    id: number;
    name: string;
};

export default function RackManagePage() {
    const [racks, setRacks] = useState<Rack[]>([]);
    const [locations, setLocations] = useState<Location[]>([]);
    const [editingRack, setEditingRack] = useState<Rack | null>(null);

    useEffect(() => {
        getRacks().then(setRacks);
        import("@/actions/locations").then(m => m.getLocations().then(setLocations));
    }, []);

    return (
        <div className="px-4 py-6 sm:px-0">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <Server className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Rack Management</h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Define and manage rack definitions for your data center.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin/rack"
                            className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                        >
                            <Grid3X3 className="h-4 w-4" />
                            View Rack Layout
                        </Link>
                        <Link
                            href="/admin"
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            <Server className="h-4 w-4" />
                            Manage Devices
                        </Link>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <Server className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total Racks</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{racks.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-500">
                            <span className="material-symbols-outlined text-lg">grid_view</span>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total Capacity</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                {racks.reduce((sum, r) => sum + (r.totalU || 42), 0)}U
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                            <span className="material-symbols-outlined text-lg">category</span>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Zones</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                {new Set(racks.map(r => r.zone).filter(Boolean)).size}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <AddRackForm locations={locations} />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white">
                    Defined Racks ({racks.length})
                </h3>
                <RackTable racks={racks} onEdit={setEditingRack} />
            </div>

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
        </div>
    );
}
