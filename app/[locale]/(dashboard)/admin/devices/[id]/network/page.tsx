import { getPortsByDevice, getVlans } from "@/actions/network";
import { getDevices } from "@/actions/master-data";
import { db } from "@/db";
import { devices, brands, locations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Network, Server, ArrowLeft, GitBranch } from "lucide-react";
import AddPortForm from "@/components/admin/add-port-form";
import PortTable from "@/components/admin/port-table";
import ImportPortForm from "@/components/admin/import-port-form";
import DeviceFaceplate from "@/components/admin/device-faceplate";
import FaceplateConfigForm from "@/components/admin/faceplate-config-form";
import FaceplatePdfButton from "@/components/admin/faceplate-pdf-button";

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
    if (!session.activeSiteId) redirect("/select-site");

    // Fetch device details
    const deviceData = await db
        .select({
            id: devices.id,
            name: devices.name,
            ipAddress: devices.ipAddress,
            locationName: locations.name,
            brandName: brands.name,
            faceplatePortCount: devices.faceplatePortCount,
            faceplateUplinkCount: devices.faceplateUplinkCount,
            faceplateRows: devices.faceplateRows,
            faceplateNumbering: devices.faceplateNumbering,
        })
        .from(devices)
        .leftJoin(brands, eq(devices.brandId, brands.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .where(and(eq(devices.id, deviceId), eq(devices.siteId, session.activeSiteId)))
        .limit(1);

    if (deviceData.length === 0) redirect("/admin");
    const device = deviceData[0];

    // Fetch dependencies for Port config forms
    const ports = await getPortsByDevice(deviceId);
    const vlans = await getVlans();

    // Pass strictly other devices for topology connections, excluding the current device.
    const allDevices = await getDevices();
    const otherDevices = allDevices.filter(d => d.id !== deviceId);

    const faceplateConfig = {
        portCount: device.faceplatePortCount,
        uplinkCount: device.faceplateUplinkCount,
        rows: device.faceplateRows,
        numbering: device.faceplateNumbering,
    };

    return (
        <div className="px-4 py-6 lg:px-6">
            <div className="mb-6">
                <Link
                    href="/admin"
                    className="inline-flex items-center gap-2 text-sm text-ops-muted hover:text-ops-text mb-4 transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Devices
                </Link>

                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="size-12 rounded-xl bg-ops-accent-soft flex items-center justify-center text-ops-accent border border-ops-accent/20">
                            <Network className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-ops-text flex items-center gap-2">
                                {device.name} Network
                                <span className="px-2 py-0.5 rounded text-xs font-mono font-medium text-ops-accent bg-ops-accent-soft border border-ops-accent/20">
                                    {device.ipAddress || "No IP"}
                                </span>
                            </h1>
                            <p className="text-sm text-ops-muted mt-1 flex items-center gap-2">
                                <Server className="h-3.5 w-3.5" />
                                {device.brandName || "Unknown Brand"} • {device.locationName || "-"}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <FaceplatePdfButton
                            deviceName={device.name}
                            deviceIp={device.ipAddress}
                            brandName={device.brandName}
                            locationName={device.locationName}
                            config={faceplateConfig}
                            ports={ports}
                        />
                        <Link
                            href={`/admin/network/vlans`}
                            className="flex items-center gap-2 px-4 py-2 bg-ops-surface-raised text-ops-muted rounded-lg hover:bg-ops-surface-sunken transition-colors"
                        >
                            <GitBranch className="size-4" />
                            VLAN Management
                        </Link>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                    <p className="text-sm text-ops-muted mb-1">Total Ports Defined</p>
                    <p className="text-2xl font-bold text-ops-text">{ports.length}</p>
                </div>
                <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                    <p className="text-sm text-ops-muted mb-1">Active Links</p>
                    <p className="text-2xl font-bold text-success">
                        {ports.filter(p => p.status === 'Active').length}
                    </p>
                </div>
                <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                    <p className="text-sm text-ops-muted mb-1">Access Ports</p>
                    <p className="text-2xl font-bold text-ops-text">
                        {ports.filter(p => p.portMode === 'Access').length}
                    </p>
                </div>
                <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-4">
                    <p className="text-sm text-ops-muted mb-1">Trunk Links</p>
                    <p className="text-2xl font-bold text-ops-text">
                        {ports.filter(p => p.portMode === 'Trunk').length}
                    </p>
                </div>
            </div>

            {/* Faceplate: physical port diagram generated from the port data below */}
            <div className="mb-6 space-y-4">
                <FaceplateConfigForm deviceId={deviceId} config={faceplateConfig} />
                <DeviceFaceplate
                    deviceId={deviceId}
                    deviceName={device.name}
                    config={faceplateConfig}
                    ports={ports}
                    vlans={vlans}
                    otherDevices={otherDevices}
                />
            </div>

            <AddPortForm deviceId={deviceId} vlans={vlans} otherDevices={otherDevices} />

            <ImportPortForm deviceId={deviceId} />

            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-ops-text flex items-center gap-2">
                    Physical & Logical Interfaces
                </h3>
                <PortTable ports={ports} vlans={vlans} otherDevices={otherDevices} deviceId={deviceId} faceplateConfig={faceplateConfig} />
            </div>
        </div>
    );
}
