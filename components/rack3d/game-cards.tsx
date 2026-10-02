"use client";

import { Html } from "@react-three/drei";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { getPortsByDevice } from "@/actions/network";
import type { RackDevice } from "@/actions/rack-layout";
import PhotoModal from "@/components/report/photo-modal";
import { FRONT_Z, SLIDE, U, uToY } from "./constants";

export type GamePort = Awaited<ReturnType<typeof getPortsByDevice>>[number];

export type CardSide = "left" | "right";

// Peer badge sits on the opposite side of the device card so the pair reads
// as a link: device card on one side, peer badge on the other.
export function peerBadgeSide(side: CardSide): CardSide {
    return side === "right" ? "left" : "right";
}

// Height of the floating card: top of the chassis + clearance so it hovers
// above the device even when the device slides out on its rails.
export function cardTopY(rackPosition: number, uHeight: number): number {
    const uh = uHeight || 1;
    return uToY(rackPosition ?? 1) + uh * U + 0.16;
}

interface DeviceGameCardProps {
    device: RackDevice;
    ports: GamePort[];
    loading: boolean;
    side: CardSide;
    onClose: () => void;
    onPickPort: (port: GamePort) => void;
}

// Network-docs card floating above the device in the 3D scene. Shows every
// port from network docs; clicking a wired port opens the peer badge,
// clicking an empty port opens Full Docs.
export function DeviceGameCard({ device, ports, loading, side, onClose, onPickPort }: DeviceGameCardProps) {
    const router = useRouter();
    const linked = ports.filter((p) => p.connectedToDeviceId != null).length;
    const openFullDocs = () => router.push(`/admin/devices/${device.id}/network`);

    return (
        <Html
            position={[side === "right" ? 0.42 : -0.42, cardTopY(device.rackPosition ?? 1, device.uHeight || 1), FRONT_Z + SLIDE + 0.05]}
            center
            distanceFactor={2.2}
            zIndexRange={[60, 0]}
            wrapperClass="pointer-events-none"
        >
            <div className="pointer-events-auto w-64 rounded-xl border border-ops-border bg-ops-surface/95 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ops-text">{device.name}</p>
                        <p className="truncate font-mono text-[11px] text-ops-muted">
                            {device.ipAddress ?? "no IP"} · {device.rackName ?? "no rack"}{device.rackPosition != null ? ` U${device.rackPosition}` : ""}
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
        </Html>
    );
}

interface PeerBadgeProps {
    port: GamePort;
    peerName: string;
    peerPhoto: string | null;
    side: CardSide;
    onClose: () => void;
    onFlyTo: () => void;
}

// Second floating card: which device is on the other end of the picked port
// and on which port — with a fly-to action and the peer photo.
export function PeerBadge({ port, peerName, peerPhoto, side, onClose, onFlyTo }: PeerBadgeProps) {
    const [photo, setPhoto] = useState<string | null>(null);
    return (
        <Html
            position={[side === "right" ? 0.42 : -0.42, cardTopY(1, 1) + 0.55, FRONT_Z + SLIDE + 0.05]}
            center
            distanceFactor={2.2}
            zIndexRange={[60, 0]}
            wrapperClass="pointer-events-none"
        >
            <div className="pointer-events-auto w-56 rounded-xl border border-ops-accent/40 bg-ops-surface/95 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                    <div className="min-w-0">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-ops-accent">Linked peer</p>
                        <p className="truncate text-sm font-bold text-ops-text">{peerName}</p>
                        <p className="truncate font-mono text-[11px] text-ops-muted">
                            port {port.portName} → {port.connectedToPortName ?? "?"} · {port.portMode ?? "no mode"}{port.vlanNumber != null ? ` · VLAN ${port.vlanNumber}` : ""}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close peer badge"
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
                    >
                        <X className="size-3.5" />
                    </button>
                </div>
                {peerPhoto && (
                    <div className="px-3 pt-2">
                        <button
                            type="button"
                            onClick={() => setPhoto(peerPhoto)}
                            aria-label={`Enlarge photo of ${peerName}`}
                            className="block w-full cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={peerPhoto} alt={peerName} className="h-20 w-full rounded-lg border border-ops-border object-cover transition-opacity hover:opacity-90" />
                        </button>
                    </div>
                )}
                <div className="px-3 py-2">
                    <button
                        type="button"
                        onClick={onFlyTo}
                        className="w-full rounded-md bg-ops-accent/15 px-2 py-1.5 text-xs font-bold text-ops-accent hover:bg-ops-accent/25"
                    >
                        Fly to {peerName}
                    </button>
                </div>
            </div>
            {photo && <PhotoModal photoPath={photo} deviceName={peerName} onClose={() => setPhoto(null)} />}
        </Html>
    );
}
