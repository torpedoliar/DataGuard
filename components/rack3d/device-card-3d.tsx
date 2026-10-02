"use client";

import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RackDevice } from "@/actions/rack-layout";
import type { DeviceDrawer } from "@/actions/device-drawer";
import PhotoModal from "@/components/report/photo-modal";

interface DeviceCard3DProps {
    device: RackDevice;
    drawer: DeviceDrawer | null;
    loading: boolean;
    onClose: () => void;
    onSelectPeer?: (deviceId: number) => void;
}

// Floating card anchored above the device in the 3D scene (via drei <Html>
// at the call site — this file is the DOM content only, so it stays
// unit-testable without WebGL). Port rows reuse the drawer connections:
// a wired port flies the camera to the peer, an empty one opens Full Docs.
export function DeviceCard3DContent({ device, drawer, loading, onClose, onSelectPeer, photoPath }: DeviceCard3DProps & { photoPath?: string | null }) {
    const router = useRouter();
    const connections = drawer?.connections ?? [];
    const linked = connections.length;
    const openFullDocs = () => router.push(`/admin/devices/${device.id}/network`);
    const [photo, setPhoto] = useState<string | null>(null);

    return (
        <div className="w-64 rounded-xl border border-ops-border bg-ops-surface/95 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ops-text">{device.name}</p>
                    <p className="truncate font-mono text-[11px] text-ops-muted">
                        {device.ipAddress ?? "no IP"} · {device.rackName ?? "no rack"}{device.rackPosition != null ? ` U${device.rackPosition}` : ""} · {device.brandName ?? "Generic"}
                    </p>
                    <p className="truncate text-[11px] text-ops-muted">
                        {device.categoryName ?? "no category"} · {device.status ?? "Pending"}{device.assetCode ? ` · ${device.assetCode}` : ""}
                    </p>
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
            <div className="px-3 py-2">
                {photoPath && (
                    <button
                        type="button"
                        onClick={() => setPhoto(photoPath)}
                        aria-label={`Enlarge photo of ${device.name}`}
                        title="Click to enlarge"
                        className="mb-2 block w-full cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoPath} alt={device.name} className="h-24 w-full rounded-lg border border-ops-border object-cover transition-opacity hover:opacity-90" />
                    </button>
                )}
                {loading ? (
                    <p className="py-2 text-center text-xs text-ops-muted">Loading ports…</p>
                ) : connections.length === 0 ? (
                    <p className="py-2 text-center text-xs text-ops-muted">No documented cabling.</p>
                ) : (
                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                        {connections.map((c) => (
                            <li key={`${c.portName}-${c.peerDeviceId}`}>
                                <button
                                    type="button"
                                    onClick={() => onSelectPeer?.(c.peerDeviceId)}
                                    aria-label={`Port ${c.portName} to ${c.peerDeviceName}`}
                                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-ops-surface-raised"
                                >
                                    <span className="size-1.5 shrink-0 rounded-full bg-ops-success" />
                                    <span className="font-mono font-semibold text-ops-text">{c.portName}</span>
                                    <span className="truncate text-ops-muted">→ {c.peerDeviceName}{c.peerPortName ? ` :${c.peerPortName}` : ""}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-ops-border px-3 py-2">
                <span className="font-mono text-[11px] text-ops-success">{linked}/{linked} Linked</span>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={openFullDocs}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-ops-accent hover:bg-ops-accent/10"
                    >
                        Ports
                    </button>
                    <Link
                        href={`/admin/devices/${device.id}/network`}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-accent hover:bg-ops-accent/10"
                    >
                        Full Docs <ExternalLink className="size-3" />
                    </Link>
                </div>
            </div>
            {photo && <PhotoModal photoPath={photo} deviceName={device.name} onClose={() => setPhoto(null)} />}
        </div>
    );
}

// Backwards-compatible named export used by the test and call sites.
export const DeviceCard3D = DeviceCard3DContent;
