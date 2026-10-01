"use client";

import { XCircle } from "lucide-react";
import type { RackDevice } from "@/actions/rack-layout";
import DeviceNetworkSummary from "./device-network-summary";

export default function DeviceDetailPanel({ device, onClose }: { device: RackDevice | null; onClose: () => void }) {
    if (!device) return null;

    const rows: [string, string | null][] = [
        ["Name", device.name],
        ["Brand", device.brandName || "-"],
        ["Category", device.categoryName],
        ["Location", device.locationName || "-"],
        ["Rack", device.rackName],
        ["Position", `U${device.rackPosition}`],
        ["Zone", device.zone || "-"],
    ];

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <aside
                role="dialog"
                aria-label="Device details"
                className="h-full w-full max-w-sm overflow-y-auto border-l border-ops-border bg-ops-surface p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-ops-text">Device Details</h3>
                    <button onClick={onClose} aria-label="Close" className="text-ops-muted hover:text-ops-text">
                        <XCircle className="h-5 w-5" />
                    </button>
                </div>
                {device.photoPath && (
                    <div className="mb-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={device.photoPath} alt={device.name} className="w-full h-40 object-cover rounded-lg border border-ops-border" />
                    </div>
                )}
                <div className="space-y-3">
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
                </div>
                <DeviceNetworkSummary device={device} />
            </aside>
        </div>
    );
}
