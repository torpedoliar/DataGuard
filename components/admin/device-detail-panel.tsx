"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Loader2, TriangleAlert, XCircle } from "lucide-react";
import type { RackDevice } from "@/actions/rack-layout";
import PhotoModal from "@/components/report/photo-modal";
import DeviceNetworkSummary from "./device-network-summary";
import { AuditSection, ConnectionsSection, IncidentsSection, SiemSection, useDeviceDrawer } from "./device-drawer-sections";

const DevicePreview = dynamic(() => import("@/components/rack3d/device-preview"), { ssr: false });
const TABS = ["Overview", "Network", "Connections", "Docs"] as const;

export default function DeviceDetailPanel({ device, onClose, onSelectPeer, docked = false, drawerState, networkState }: {
    device: RackDevice | null;
    onClose: () => void;
    onSelectPeer?: (deviceId: number) => boolean;
    /** Inside the 3D box, not a page overlay. 2D keeps the overlay. */
    docked?: boolean;
    drawerState?: ReturnType<typeof useDeviceDrawer>;
    networkState?: React.ComponentProps<typeof DeviceNetworkSummary>["supplied"];
}) {
    const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
    const [photo, setPhoto] = useState<string | null>(null);
    const drawer = useDeviceDrawer(device?.id ?? null, drawerState);
    if (!device) return null;

    const pic = drawer.data?.picGroups.map((g) => g.name).join(", ");
    const rows: [string, string | null][] = [
        ["Name", device.name],
        ["Brand", device.brandName || "-"],
        ["Category", device.categoryName],
        ["Location", device.locationName || "-"],
        ["Rack", device.rackName],
        ["Position", `U${device.rackPosition}`],
        ["Zone", device.zone || "-"],
        ["IP address", device.ipAddress || "-"],
        ["Asset code", device.assetCode || "-"],
        ["PIC group", drawer.loading ? "…" : pic || "-"],
    ];

    const aside = (
            <aside
                role="dialog"
                aria-label="Device details"
                className={docked
                    ? "absolute inset-y-0 right-0 z-20 h-full w-full max-w-sm overflow-y-auto border-l border-ops-border bg-ops-surface p-6 shadow-xl"
                    : "h-full w-full max-w-sm overflow-y-auto border-l border-ops-border bg-ops-surface p-6 shadow-xl"}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-ops-text">Device Details</h3>
                    <button onClick={onClose} aria-label="Close" className="text-ops-muted hover:text-ops-text">
                        <XCircle className="h-5 w-5" />
                    </button>
                </div>
                {device.isCritical && (
                    <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-ops-danger/50 bg-ops-danger/10 px-3 py-2 text-sm font-medium text-ops-danger">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        Critical device. Coordinate with the PIC before any action.
                    </div>
                )}
                {docked && <DevicePreview key={device.id} device={device} />}
                {docked && <div role="tablist" aria-label="Device information" className="mb-4 flex border-b border-ops-border">{TABS.map((name, index) => <button key={name} id={`device-${device.id}-tab-${name}`} type="button" role="tab" aria-controls={`device-${device.id}-panel`} tabIndex={tab === name ? 0 : -1} aria-selected={tab === name} onKeyDown={(event) => {
                    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
                    if (next === null) return;
                    event.preventDefault();
                    setTab(TABS[next]);
                    document.getElementById(`device-${device.id}-tab-${TABS[next]}`)?.focus();
                }} onClick={() => setTab(name)} className={`flex-1 border-b-2 px-1 py-2 text-xs font-semibold ${tab === name ? "border-ops-accent text-ops-accent" : "border-transparent text-ops-muted"}`}>{name}</button>)}</div>}
                <div id={`device-${device.id}-panel`} role={docked ? "tabpanel" : undefined} aria-labelledby={docked ? `device-${device.id}-tab-${tab}` : undefined}>
                {(!docked || tab === "Docs") && device.photoPath && (
                    <div className="mb-4">
                        <button
                            type="button"
                            onClick={() => setPhoto(device.photoPath)}
                            aria-label={`Enlarge photo of ${device.name}`}
                            title="Click to enlarge"
                            className="block w-full cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={device.photoPath} alt={device.name} className="h-40 w-full rounded-lg border border-ops-border object-cover transition-opacity hover:opacity-90" />
                        </button>
                    </div>
                )}
                {(!docked || tab === "Overview") && <div className="space-y-3">
                    {rows.map(([label, value]) => (
                        <div key={label}>
                            <label className="text-xs text-ops-muted">{label}</label>
                            <p className="font-medium text-ops-text">{value}</p>
                        </div>
                    ))}
                    <div>
                        <label className="text-xs text-ops-muted">Status</label>
                        <p className={`font-medium ${
                            device.status === "NOT OK" ? "text-ops-danger" :
                            device.status === "OK" ? "text-ops-success" : "text-ops-muted"
                        }`}>
                            {device.status || "Pending"}
                        </p>
                    </div>
                </div>}
                {drawer.error && <p role="alert" className="mt-4 text-xs text-ops-danger">Unable to load device details.</p>}
                {drawer.loading && (
                    <p className="mt-5 flex items-center gap-2 text-xs text-ops-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading audit, incidents and cabling…</p>
                )}
                {drawer.data && (!docked || tab === "Overview") && (
                    <>
                        <AuditSection drawer={drawer.data} onPhoto={setPhoto} />
                        <IncidentsSection drawer={drawer.data} />
                        <SiemSection drawer={drawer.data} />
                    </>
                )}
                {(!docked || tab === "Network") && <DeviceNetworkSummary key={device.id} device={device} supplied={networkState} />}
                {drawer.data && (!docked || tab === "Connections") && <ConnectionsSection drawer={drawer.data} onSelectPeer={onSelectPeer} />}
                {docked && tab === "Docs" && <div className="space-y-2 text-sm"><Link href={`/admin/devices/${device.id}/network`} className="font-semibold text-ops-accent hover:underline">Open network documentation</Link>{!device.photoPath && <p className="text-xs text-ops-muted">No device photograph documented.</p>}<p className="text-xs text-ops-muted">Ports, VLANs and cabling use the existing network documentation.</p></div>}
                </div>
            </aside>
    );

    return (
        <>
            {docked ? aside : (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
                    {aside}
                </div>
            )}
            {photo && <PhotoModal photoPath={photo} deviceName={device.name} onClose={() => setPhoto(null)} />}
        </>
    );
}
