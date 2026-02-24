
import { getCategories, getDevices } from "@/actions/master-data";
import AddDeviceForm from "@/components/admin/add-device-form";
import DeviceTable from "@/components/admin/device-table";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Tag } from "lucide-react";

export default async function AdminPage() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const categories = await getCategories();
    const devices = await getDevices();
    const { getBrands } = await import("@/actions/brands");
    const brands = await getBrands();
    const { getLocations } = await import("@/actions/locations");
    const locations = await getLocations();

    return (
        <div className="max-w-[1600px] mx-auto px-5 py-6">
            <div className="mb-6">
                <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400">
                        <span className="material-symbols-outlined">dns</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white font-display">Device Management</h1>
                        <p className="text-sm text-slate-400">
                            {session.activeSiteName ? `Site: ${session.activeSiteName}` : "Manage data center devices and locations."}
                        </p>
                    </div>
                </div>
            </div>

            {/* Quick Access Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 mb-8">
                <Link href="/admin/network/vlans" className="glow-card p-4 hover:border-teal-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-teal-500/15 flex items-center justify-center text-teal-400">
                            <span className="material-symbols-outlined">hub</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">VLANs</h3>
                            <p className="text-xs text-slate-500">Network</p>
                        </div>
                    </div>
                </Link>
                <Link href="/admin/categories" className="glow-card p-4 hover:border-orange-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-orange-500/15 flex items-center justify-center text-orange-400">
                            <Tag className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">Categories</h3>
                            <p className="text-xs text-slate-500">Manage</p>
                        </div>
                    </div>
                </Link>
                <Link href="/admin/brands" className="glow-card p-4 hover:border-blue-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400">
                            <span className="material-symbols-outlined">local_offer</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">Brands</h3>
                            <p className="text-xs text-slate-500">Manage</p>
                        </div>
                    </div>
                </Link>
                <Link href="/admin/locations" className="glow-card p-4 hover:border-emerald-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                            <span className="material-symbols-outlined">pin_drop</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">Locations</h3>
                            <p className="text-xs text-slate-500">Rooms</p>
                        </div>
                    </div>
                </Link>
                <Link href="/admin/rack-manage" className="glow-card p-4 hover:border-blue-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400">
                            <span className="material-symbols-outlined">view_in_ar</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">Racks</h3>
                            <p className="text-xs text-slate-500">Manage</p>
                        </div>
                    </div>
                </Link>
                <Link href="/admin/rack" className="glow-card p-4 hover:border-green-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-green-500/15 flex items-center justify-center text-green-400">
                            <span className="material-symbols-outlined">grid_view</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">Layout</h3>
                            <p className="text-xs text-slate-500">Visual</p>
                        </div>
                    </div>
                </Link>
                <Link href="/admin/users" className="glow-card p-4 hover:border-purple-500/30">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-purple-500/15 flex items-center justify-center text-purple-400">
                            <span className="material-symbols-outlined">group</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-white text-sm">Users</h3>
                            <p className="text-xs text-slate-500">Roles</p>
                        </div>
                    </div>
                </Link>
                {session.role === "superadmin" && (
                    <Link href="/admin/sites" className="glow-card p-4 hover:border-rose-500/30">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-lg bg-rose-500/15 flex items-center justify-center text-rose-400">
                                <span className="material-symbols-outlined">domain</span>
                            </div>
                            <div>
                                <h3 className="font-semibold text-white text-sm">Sites</h3>
                                <p className="text-xs text-slate-500">Multi-site</p>
                            </div>
                        </div>
                    </Link>
                )}
            </div>

            <AddDeviceForm categories={categories} brands={brands} locations={locations} />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-white font-display">Device List ({devices.length})</h3>
                <DeviceTable devices={devices} brands={brands} locations={locations} />
            </div>
        </div>
    );
}
