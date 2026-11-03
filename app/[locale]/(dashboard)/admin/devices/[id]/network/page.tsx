import { getPortsByDevice, getVlans } from "@/actions/network";
import { getDevices } from "@/actions/master-data";
import { db } from "@/db";
import { devices, brands, locations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, GitBranch } from "lucide-react";
import AddPortForm from "@/components/admin/add-port-form";
import PortTable from "@/components/admin/port-table";
import ImportPortForm from "@/components/admin/import-port-form";
import DeviceFaceplate from "@/components/admin/device-faceplate";
import FaceplateConfigForm from "@/components/admin/faceplate-config-form";
import FaceplatePdfButton from "@/components/admin/faceplate-pdf-button";
import ActionButton from "@/components/ui/action-button";
import PageHeader from "@/components/ui/page-header";

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

    const stats: { label: string; value: number; tone?: "success" }[] = [
        { label: "Total ports defined", value: ports.length },
        { label: "Active links", value: ports.filter(p => p.status === 'Active').length, tone: "success" },
        { label: "Access ports", value: ports.filter(p => p.portMode === 'Access').length },
        { label: "Trunk links", value: ports.filter(p => p.portMode === 'Trunk').length },
    ];

    return (
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <div className="flex flex-col gap-4">
                <Link
                    href="/admin"
                    className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ops-muted transition-colors hover:text-ops-text"
                >
                    <ArrowLeft className="size-3.5" />
                    Back to devices
                </Link>

                <PageHeader
                    eyebrow="Admin / Network"
                    title={`${device.name} network`}
                    description={`${device.brandName || "Unknown brand"} · ${device.locationName || "Unassigned"} · ${device.ipAddress || "No IP documented"}`}
                    actions={
                        <>
                            <FaceplatePdfButton
                                deviceName={device.name}
                                deviceIp={device.ipAddress}
                                brandName={device.brandName}
                                locationName={device.locationName}
                                config={faceplateConfig}
                                ports={ports}
                            />
                            <ActionButton href="/admin/network/vlans" variant="secondary" icon={<GitBranch className="size-4" />}>
                                VLAN management
                            </ActionButton>
                        </>
                    }
                />
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {stats.map((stat) => (
                    <div key={stat.label} className="ops-panel p-4">
                        <p className="text-[13px] text-ops-muted">{stat.label}</p>
                        <p className={`mt-1 text-2xl font-semibold tabular-nums leading-tight ${stat.tone === "success" ? "text-ops-success" : "text-ops-text"}`}>
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Faceplate: physical port diagram generated from the port data below */}
            <div className="space-y-4">
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

            <section className="flex flex-col gap-4">
                <div className="flex items-end justify-between gap-3">
                    <div>
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Physical &amp; logical interfaces</h2>
                        <p className="mt-0.5 text-[13px] text-ops-muted">Port state, VLAN assignment, and documented cabling.</p>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-ops-muted">{ports.length} ports</span>
                </div>
                <PortTable ports={ports} vlans={vlans} otherDevices={otherDevices} deviceId={deviceId} faceplateConfig={faceplateConfig} />
            </section>
        </main>
    );
}
