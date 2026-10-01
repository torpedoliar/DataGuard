"use client";

import { TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { FilteredDevice } from "@/lib/rack-filter";

export interface CriticalItem {
    device: FilteredDevice;
    rackName: string;
    reason: string;
}

export function CriticalAlert({ open, items, onClose, onPick }: {
    open: boolean;
    items: CriticalItem[];
    onClose: () => void;
    onPick: (device: FilteredDevice) => void;
}) {
    return (
        <Modal
            open={open && items.length > 0}
            onClose={onClose}
            title={`${items.length} critical device${items.length > 1 ? "s" : ""} need attention`}
            description="Critical devices with a failed check today or an open incident. Pick one to fly to it."
        >
            <ul className="space-y-2">
                {items.map(({ device, rackName, reason }) => (
                    <li key={device.id}>
                        <button
                            type="button"
                            onClick={() => onPick(device)}
                            className="flex w-full items-start gap-3 rounded-lg border border-ops-danger/40 bg-ops-danger/10 px-3 py-2 text-left hover:bg-ops-danger/20"
                        >
                            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ops-danger" />
                            <span>
                                <span className="block text-sm font-semibold text-ops-text">{device.name}</span>
                                <span className="block text-xs text-ops-muted">{rackName} · {reason}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </Modal>
    );
}
