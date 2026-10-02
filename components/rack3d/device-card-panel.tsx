"use client";

import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RackDevice } from "@/actions/rack-layout";
import type { getPortsByDevice } from "@/actions/network";
import PhotoModal from "@/components/report/photo-modal";

export type CardPort = Awaited<ReturnType<typeof getPortsByDevice>>[number];

interface DeviceCardPanelProps {
    device: Pick<RackDevice, "id" | "name" | "ipAddress" | "photoPath">;
    ports: CardPort[];
    loading: boolean;
    onClose: () => void;
    onSelectPeer?: (deviceId: number) => void;
}

// Device info panel docked to the right of the 3D scene container (plain
// DOM, not drei <Html>): always visible while a device is selected, never
// clipped by the canvas, and clickable without raycast fights. Port rows
// come from network docs (getPortsByDevice): every port renders — wired
// rows fly the camera to the peer, empty rows open Full Docs.
export function DeviceCardPanel({ device, ports, loading, onClose, onSelectPeer }: DeviceCardPanelProps) {
    const router = useRouter();
    const [photo, setPhoto] = useState<string | null>(null);
    const linked = ports.filter((p) => p.connectedToDeviceId != null).length;
    const openFullDocs = () => router.push(`/admin/devices/${device.id}/network`);

    return (
        <div className="pointer-events-auto w-72 shrink-0 overflow-hidden rounded-xl border border-ops-border bg-ops-surface/95 shadow-xl backdrop-blur">
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
            <div className="max-h-64 overflow-y-auto px-3 py-2">
                {device.photoPath && (
                    <button
                        type="button"
                        onClick={() => setPhoto(device.photoPath!)}
                        aria-label={`Enlarge photo of ${device.name}`}
                        title="Click to enlarge"
                        className="mb-2 block w-full cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={device.photoPath} alt={device.name} className="h-24 w-full rounded-lg border border-ops-border object-cover transition-opacity hover:opacity-90" />
                    </button>
                )}
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
                                        onClick={() => {
                                            if (wired) onSelectPeer?.(p.connectedToDeviceId!);
                                            else openFullDocs();
                                        }}
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
            {photo && <PhotoModal photoPath={photo} deviceName={device.name} onClose={() => setPhoto(null)} />}
        </div>
    );
}
