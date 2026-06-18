import { getLocations } from "@/actions/locations";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MapPin, Server } from "lucide-react";
import AddLocationForm from "@/components/admin/add-location-form";
import LocationTable from "@/components/admin/location-table";

export default async function LocationsPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const locations = await getLocations();

    return (
        <div className="px-4 py-6 sm:px-0">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <MapPin className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Location Management</h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Manage data center rooms, zones, or specific areas for equipment mapping.
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <MapPin className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total Locations</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{locations.length}</p>
                        </div>
                    </div>
                </div>
            </div>

            <AddLocationForm />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white">
                    Locations List
                </h3>
                <LocationTable locations={locations} />
            </div>
        </div>
    );
}
