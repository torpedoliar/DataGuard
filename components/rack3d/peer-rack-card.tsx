"use client";

import dynamic from "next/dynamic";
import { ExternalLink, X } from "lucide-react";
import type { RackDevice } from "@/actions/rack-layout";
import type { SceneRack } from "@/lib/rack-filter";

// Same lazy pattern as the main scene in rack-view-3d.tsx: three.js never loads
// on the server, and the DOM shell below stays testable in the node env.
const PeerRackMini = dynamic(() => import("./peer-rack-mini"), {
    ssr: false,
    loading: () => <div className="grid h-56 place-items-center text-xs text-ops-muted">Loading rack…</div>,
});

const UNASSIGNED = "Unassigned Location";

// The peer lives in another room, so it cannot show up in this scene. Instead
// of a fly-to that would lose the device the user came from, the rack gets a
// small model in the same view; only the button moves the camera.
export function PeerRackCard({ rack, peer, portName, onMove, onClose }: {
    rack: SceneRack;
    peer: RackDevice;
    portName: string | null;
    onMove: () => void;
    onClose: () => void;
}) {
    return (
        <div className="absolute bottom-14 left-3 z-20 w-[260px] overflow-hidden rounded-xl border border-ops-accent/40 bg-ops-surface/95 shadow-lg backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                <p className="truncate text-xs font-semibold text-ops-text">
                    {rack.locationName || UNASSIGNED} · {rack.name} · U{peer.rackPosition ?? "—"}
                </p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close peer rack card"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
                >
                    <X className="size-3.5" />
                </button>
            </div>
            <div className="h-56 bg-ops-bg">
                <PeerRackMini devices={rack.devices} totalU={rack.totalU || 42} peerId={peer.id} />
            </div>
            <div className="space-y-1 border-t border-ops-border px-3 py-2">
                <p className="truncate text-xs font-semibold text-ops-text">{peer.name}</p>
                <p className="truncate text-[11px] text-ops-muted">{portName ? `Port ${portName}` : "Peer port"}</p>
                <button
                    type="button"
                    onClick={onMove}
                    className="flex w-full items-center justify-center gap-1 rounded-md bg-ops-accent px-2 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                    <ExternalLink className="size-3" /> Move to location
                </button>
            </div>
        </div>
    );
}
