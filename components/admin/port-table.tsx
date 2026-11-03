"use client";

import { Edit, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import EditPortModal from "./edit-port-modal";
import DeletePortModal from "./delete-port-modal";
import { DataTableEmpty } from "@/components/ui/data-table";
import { buildFaceplate, normalizeFaceplateConfig, resolveSlotPlacement, slotOccupants, type FaceplateConfigInput } from "@/lib/faceplate";

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

type Port = {
    id: number;
    deviceId: number;
    portName: string;
    portIndex?: number | null;
    macAddress: string | null;
    ipAddress: string | null;
    portMode: string | null;
    vlanId: number | null;
    vlanName: string | null;
    vlanNumber: number | null;
    trunkVlans: string | null;
    status: string | null;
    speed: string | null;
    mediaType: string | null;
    connectedToDeviceId: number | null;
    connectedToDeviceName: string | null;
    connectedToPortId: number | null;
    connectedToPortName: string | null;
    description: string | null;
};

export default function PortTable({
    ports,
    vlans,
    otherDevices,
    deviceId,
    faceplateConfig,
}: {
    ports: Port[];
    vlans: Vlan[];
    otherDevices: Device[];
    deviceId: number;
    faceplateConfig?: FaceplateConfigInput;
}) {
    const [editingPort, setEditingPort] = useState<Port | null>(null);
    const [deletingPort, setDeletingPort] = useState<Port | null>(null);

    // When a faceplate exists, show which physical slot each port resolves to so a
    // port missing from the diagram is explainable straight from the table.
    const config = useMemo(() => normalizeFaceplateConfig(faceplateConfig), [faceplateConfig]);
    const showSlotColumn = config.portCount > 0;
    // Resolve placement once, mirroring the diagram: a port that lost its slot to
    // another port (override precedence or a collision) renders Unmapped instead
    // of a slot number the faceplate does not honour.
    const placement = useMemo(
        () => (showSlotColumn ? buildFaceplate(config, ports) : null),
        [showSlotColumn, config, ports],
    );
    const occupants = useMemo(
        () => (placement ? slotOccupants(placement) : new Map<number, Port>()),
        [placement],
    );

    const getStatusIndicator = (status: string | null) => {
        if (status === 'Active') return <span className="flex items-center gap-1.5 text-ops-success"><span className="size-2 rounded-full bg-ops-success"></span> Active</span>;
        if (status === 'Inactive') return <span className="flex items-center gap-1.5 text-ops-muted"><span className="size-2 rounded-full bg-ops-surface-sunken"></span> Inactive</span>;
        if (status === 'Down') return <span className="flex items-center gap-1.5 text-ops-danger"><span className="size-2 rounded-full bg-ops-danger"></span> Down</span>;
        return <span className="text-ops-muted">-</span>;
    };

    return (
        <div className="ops-panel overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-ops-border bg-ops-surface-raised text-xs font-medium text-ops-muted">
                        <tr>
                            {showSlotColumn && (
                                <th className="h-9 w-20 whitespace-nowrap px-4 text-left">Slot</th>
                            )}
                            <th className="h-9 whitespace-nowrap px-4 text-left">Interface</th>
                            <th className="h-9 whitespace-nowrap px-4 text-left">Status</th>
                            <th className="h-9 whitespace-nowrap px-4 text-left">Media &amp; speed</th>
                            <th className="h-9 whitespace-nowrap px-4 text-left">Logical config</th>
                            <th className="h-9 whitespace-nowrap px-4 text-left">Topology (connects to)</th>
                            <th className="h-9 w-24 whitespace-nowrap px-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ops-border bg-ops-surface [&>tr:hover]:bg-ops-surface-raised/60">
                        {ports.length === 0 ? (
                            <DataTableEmpty colSpan={showSlotColumn ? 7 : 6} title="No ports provisioned" description="Add a port above to start documenting this device." />
                        ) : (
                            ports.map((port) => (
                                <tr key={port.id} className="transition-colors">
                                    {showSlotColumn && (
                                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                                            {(() => {
                                                const slotPlacement = resolveSlotPlacement(port, config, occupants);
                                                if (!slotPlacement.placed) {
                                                    return (
                                                        <span
                                                            className="inline-flex items-center rounded-sm bg-ops-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-ops-warning"
                                                            title={
                                                                slotPlacement.conflict
                                                                    ? `Slot ${slotPlacement.slotNumber} di diagram faceplate ditempati port lain. Atur Slot Faceplate port ini agar tidak bentrok.`
                                                                    : "Port ini tidak terpetakan ke slot faceplate. Isi Slot Faceplate pada port ini, atau perbesar jumlah port di panel Faceplate Layout."
                                                            }
                                                        >
                                                            Unmapped
                                                        </span>
                                                    );
                                                }
                                                return (
                                                    <span className="font-mono text-sm text-ops-text" title={port.portIndex ? "Slot diisi manual" : "Slot disimpulkan dari nama interface"}>
                                                        {slotPlacement.slotNumber}
                                                        {!port.portIndex && <span className="ml-1 text-[10px] text-ops-muted">auto</span>}
                                                    </span>
                                                );
                                            })()}
                                        </td>
                                    )}
                                    <td className="whitespace-nowrap px-4 py-2.5">
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-ops-text">{port.portName}</span>
                                            {port.macAddress && <span className="font-mono text-xs text-ops-muted">{port.macAddress}</span>}
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2.5 text-[13px] font-medium">
                                        {getStatusIndicator(port.status)}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2.5">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[13px] tabular-nums text-ops-text">{port.speed}</span>
                                            <span className="text-xs text-ops-muted">{port.mediaType}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex flex-col items-start gap-1">
                                            <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium
                                                ${port.portMode === 'Trunk' ? 'bg-ops-info-soft text-ops-info' :
                                                    port.portMode === 'Routed' ? 'bg-ops-orange-soft text-ops-orange' :
                                                        'bg-ops-info-soft text-ops-info'}`}>
                                                {port.portMode}
                                            </span>

                                            {port.portMode === 'Access' && port.vlanNumber && (
                                                <span className="text-xs font-medium text-ops-muted">VLAN <span className="tabular-nums">{port.vlanNumber}</span> <span className="font-normal text-ops-muted">({port.vlanName})</span></span>
                                            )}
                                            {port.portMode === 'Trunk' && (
                                                <div className="flex flex-col text-xs text-ops-muted">
                                                    {port.vlanNumber && <span className="text-[10px] text-ops-subtle">Native: {port.vlanNumber}</span>}
                                                    <span className="font-mono">Allowed: {port.trunkVlans || 'All'}</span>
                                                </div>
                                            )}
                                            {port.portMode === 'Routed' && (
                                                <span className="rounded-sm border border-ops-border bg-ops-surface-raised px-1.5 py-0.5 font-mono text-xs font-medium text-ops-muted">
                                                    {port.ipAddress}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-[13px]">
                                        {port.connectedToDeviceName ? (
                                            <div className="flex flex-col">
                                                <span className="font-medium text-ops-text">{port.connectedToDeviceName}</span>
                                                <span className="font-mono text-xs text-ops-muted">Port: {port.connectedToPortName || 'Unknown'}</span>
                                            </div>
                                        ) : (
                                            <span className="text-ops-muted">Unconnected</span>
                                        )}
                                        {port.description && (
                                            <p className="mt-1 max-w-[150px] truncate text-[10px] text-ops-muted" title={port.description}>
                                                &quot;{port.description}&quot;
                                            </p>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-medium">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setEditingPort(port)}
                                                className="rounded-md p-1.5 text-ops-info transition-colors hover:bg-ops-info-soft"
                                                title="Edit Port"
                                                aria-label={`Edit port ${port.portName}`}
                                            >
                                                <Edit className="size-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeletingPort(port)}
                                                className="rounded-md p-1.5 text-ops-danger transition-colors hover:bg-ops-danger-soft"
                                                title="Delete Port"
                                                aria-label={`Delete port ${port.portName}`}
                                            >
                                                <Trash2 className="size-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {editingPort && (
                <EditPortModal
                    port={editingPort}
                    vlans={vlans}
                    otherDevices={otherDevices}
                    onClose={() => setEditingPort(null)}
                    deviceId={deviceId}
                />
            )}

            {deletingPort && (
                <DeletePortModal port={deletingPort} onClose={() => setDeletingPort(null)} />
            )}
        </div>
    );
}
