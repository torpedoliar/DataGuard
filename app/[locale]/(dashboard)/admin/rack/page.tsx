import { getRackLayout, getRackStats } from "@/actions/rack-layout";
import RackLayout from "@/components/admin/rack-layout";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Server, PieChart, MapPin } from "lucide-react";

export default async function RackPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const racks = await getRackLayout();
    const stats = await getRackStats();
    const { getCategories } = await import("@/actions/master-data");
    const categories = await getCategories();

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
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Rack Layout</h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Visual overview of device positions in racks.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
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
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                                <Server className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Total Devices</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalDevices}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-500">
                                <MapPin className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400">In Rack Positions</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.devicesWithRack}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                                <PieChart className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Zones</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.devicesByZone.length}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Rack Layout Visualization */}
            <RackLayout racks={racks} categories={categories} />
        </div>
    );
}
