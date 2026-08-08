import { getRackLayout, getRackStats } from "@/actions/rack-layout";
import RackLayout from "@/components/admin/rack-layout";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Server, PieChart, MapPin } from "lucide-react";
import { OfflineBanner } from "@/components/mobile/offline-banner";
import { BottomNav } from "@/components/mobile/bottom-nav";

export default async function RackPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const racks = await getRackLayout();
    const stats = await getRackStats();
    const { getCategories } = await import("@/actions/master-data");
    const categories = await getCategories();

    return (
        <>
        <OfflineBanner />
        <main className="px-4 py-6 lg:px-6 pb-20">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-ops-accent/20 flex items-center justify-center text-ops-accent">
                                <Server className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-ops-text">Rack Layout</h1>
                                <p className="text-sm text-ops-muted">
                                    Visual overview of device positions in racks.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin"
                            className="flex items-center gap-2 px-4 py-2 bg-ops-surface-raised text-ops-text rounded-lg hover:bg-ops-surface transition-colors"
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
                    <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-ops-info/10 flex items-center justify-center text-ops-info">
                                <Server className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-sm text-ops-muted">Total Devices</p>
                                <p className="text-2xl font-bold text-ops-text">{stats.totalDevices}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-ops-success/10 flex items-center justify-center text-ops-success">
                                <MapPin className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-sm text-ops-muted">In Rack Positions</p>
                                <p className="text-2xl font-bold text-ops-text">{stats.devicesWithRack}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-ops-accent/10 flex items-center justify-center text-ops-accent">
                                <PieChart className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-sm text-ops-muted">Zones</p>
                                <p className="text-2xl font-bold text-ops-text">{stats.devicesByZone.length}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Rack Layout Visualization */}
            <div className="overflow-x-auto">
                <RackLayout racks={racks} categories={categories} />
            </div>
        </main>
        <BottomNav />
        </>
    );
}
