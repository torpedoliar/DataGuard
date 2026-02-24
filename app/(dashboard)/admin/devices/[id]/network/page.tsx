import { getPortsByDevice, getVlans } from "@/actions/network";
import { getDevices } from "@/actions/master-data";
import { db } from "@/db";
import { devices, brands, locations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Network, Server, ArrowLeft } from "lucide-react";
import AddPortForm from "@/components/admin/add-port-form";
import PortTable from "@/components/admin/port-table";

export default async function NetworkDocumentationPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

    const resolvedParams = await params;
    const deviceId = parseInt(resolvedParams.id, 10);
    if (isNaN(deviceId)) redirect("/admin");

    // Fetch device details
    const deviceData = await db
        .select({
            id: devices.id,
            name: devices.name,
            ipAddress: devices.ipAddress,
            locationName: locations.name,
            brandName: brands.name,
        })
        .from(devices)
        .leftJoin(brands, eq(devices.brandId, brands.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .where(eq(devices.id, deviceId))
        .limit(1);

    if (deviceData.length === 0) redirect("/admin");
    const device = deviceData[0];

    // Fetch dependencies for Port config forms
    const ports = await getPortsByDevice(deviceId);
    const vlans = await getVlans();

    // Pass strictly other devices for topology connections, excluding the current device.
    const allDevices = await getDevices();
    const otherDevices = allDevices.filter(d => d.id !== deviceId);

    return (
        <div className="px-4 py-6 sm:px-0">
            <div className="mb-6">
                <Link
                    href="/admin"
                    className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 mb-4 transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Devices
                </Link>

                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="size-12 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-500 border border-teal-500/20">
                            <Network className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                {device.name} Network
                                <span className="px-2 py-0.5 rounded text-xs font-mono font-medium text-teal-700 bg-teal-100 dark:bg-teal-900/40 dark:text-teal-400 border border-teal-200 dark:border-teal-800">
                                    {device.ipAddress || "No IP"}
                                </span>
                            </h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
                                <Server className="h-3.5 w-3.5" />
                                {device.brandName || "Unknown Brand"} • {device.locationName || "-"}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link
                            href={`/admin/network/vlans`}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            <span className="material-symbols-outlined text-sm">hub</span>
                            VLAN Management
                        </Link>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Ports Defined</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{ports.length}</p>
                </div>
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Active Links</p>
                    <p className="text-2xl font-bold text-success">
                        {ports.filter(p => p.status === 'Active').length}
                    </p>
                </div>
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Access Ports</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {ports.filter(p => p.portMode === 'Access').length}
                    </p>
                </div>
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Trunk Links</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {ports.filter(p => p.portMode === 'Trunk').length}
                    </p>
                </div>
            </div>

            <AddPortForm deviceId={deviceId} vlans={vlans} otherDevices={otherDevices} />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                    Physical & Logical Interfaces
                </h3>
                <PortTable ports={ports} vlans={vlans} otherDevices={otherDevices} deviceId={deviceId} />
            </div>
        </div>
    );
}
