"use client";

import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { getPortsByDevice } from "@/actions/network";
import type { RackDevice } from "@/actions/rack-layout";

export type FloatPort = Awaited<ReturnType<typeof getPortsByDevice>>[number];

interface DeviceFloatCardProps {
    device: Pick<RackDevice, "id" | "name" | "ipAddress">;
    ports: FloatPort[];
    loading: boolean;
    onClose: () => void;
    onPickPort: (port: FloatPort) => void;
}

// Network-docs card content floating above the device in the 3D scene. DOM
// only (rendered inside a plain drei <Html> by the caller, same props as the
// proven hover tooltip and cable labels: NO distanceFactor, so the pixel size
// stays constant at any camera distance). Shows every port; a wired port
// opens the peer badge, an empty port opens Full Docs.
export function DeviceFloatCard({ device, ports, loading, onClose, onPickPort }: DeviceFloatCardProps) {
    const router = useRouter();
    const linked = ports.filter((p) => p.connectedToDeviceId != null).length;
    const openFullDocs = () => router.push(`/admin/devices/${device.id}/network`);

    return (
        <div className="w-64 rounded-xl border border-ops-border bg-ops-surface/95 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ops-text">{device.name}</p>
                    <p className="truncate font-mono text-[11px] text-ops-muted">{device.ipAddress ?? "no IP"}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={`Close ${device.name} card`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
                >
                    <X className="size-3.5" />
                </button>
            </div>
            <div className="max-h-56 overflow-y-auto px-3 py-2">
                {loading ? (
                    <p className="py-2 text-center text-xs text-ops-muted">Loading ports…</p>
                ) : ports.length === 0 ? (
                    <p className="py-2 text-center text-xs text-ops-muted">No ports documented.</p>
                ) : (
                    <ul className="space-y-1">
                        {ports.map((p) => {
                            const wired = p.connectedToDeviceId != null;
                            return (
                                <li key={p.id}>
                                    <button
                                        type="button"
                                        onClick={() => { if (wired) onPickPort(p); else openFullDocs(); }}
                                        aria-label={wired ? `Port ${p.portName} to ${p.connectedToDeviceName}` : `Port ${p.portName}, not linked, open network docs`}
                                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-ops-surface-raised"
                                    >
                                        <span className={`size-1.5 shrink-0 rounded-full ${p.status === "Active" ? "bg-ops-success" : "bg-ops-muted"}`} />
                                        <span className="font-mono font-semibold text-ops-text">{p.portName}</span>
                                        {p.vlanNumber != null && <span className="font-mono text-[10px] text-ops-accent">VLAN {p.vlanNumber}</span>}
                                        <span className="truncate text-ops-muted">
                                            {wired ? `→ ${p.connectedToDeviceName}${p.connectedToPortName ? ` :${p.connectedToPortName}` : ""}` : "Not linked"}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-ops-border px-3 py-2">
                <span className="font-mono text-[11px] text-ops-success">{linked}/{ports.length} Linked</span>
                <Link
                    href={`/admin/devices/${device.id}/network`}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-accent hover:bg-ops-accent/10"
                >
                    Full Docs <ExternalLink className="size-3" />
                </Link>
            </div>
        </div>
    );
}
