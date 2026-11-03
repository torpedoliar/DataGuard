"use client";

import { Edit, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import EditPortModal from "./edit-port-modal";
import DeletePortModal from "./delete-port-modal";
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
        if (status === 'Active') return <span className="flex items-center gap-1 text-success"><span className="w-2 h-2 rounded-full bg-success"></span> Active</span>;
        if (status === 'Inactive') return <span className="flex items-center gap-1 text-ops-subtle"><span className="w-2 h-2 rounded-full bg-ops-surface-sunken"></span> Inactive</span>;
        if (status === 'Down') return <span className="flex items-center gap-1 text-error"><span className="w-2 h-2 rounded-full bg-error"></span> Down</span>;
        return <span className="text-ops-muted">-</span>;
    };

    return (
        <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-ops-border">
                    <thead className="bg-ops-surface">
                        <tr>
                            {showSlotColumn && (
                                <th className="px-4 py-3 text-left text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider w-20">Slot</th>
                            )}
                            <th className="px-4 py-3 text-left text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider">Interface</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider">Media & Speed</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider">Logical Config</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider">Topology (Connects To)</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-ops-subtle dark:text-ops-muted uppercase tracking-wider w-24">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-ops-surface divide-y divide-ops-border">
                        {ports.length === 0 ? (
                            <tr>
                                <td colSpan={showSlotColumn ? 7 : 6} className="px-6 py-8 text-center text-sm text-ops-subtle dark:text-ops-muted">
                                    No ports provisioned for this device.
                                </td>
                            </tr>
                        ) : (
                            ports.map((port) => (
                                <tr key={port.id} className="hover:bg-ops-surface dark:hover:bg-ops-surface-raised/50 transition-colors">
                                    {showSlotColumn && (
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {(() => {
                                                const slotPlacement = resolveSlotPlacement(port, config, occupants);
                                                if (!slotPlacement.placed) {
                                                    return (
                                                        <span
                                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-ops-warning-soft text-ops-warning dark:bg-ops-warning-soft dark:text-ops-warning"
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
                                                        {!port.portIndex && <span className="text-ops-muted text-[10px] ml-1">auto</span>}
                                                    </span>
                                                );
                                            })()}
                                        </td>
                                    )}
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-ops-text uppercase tracking-wider">{port.portName}</span>
                                            {port.macAddress && <span className="text-xs text-ops-subtle font-mono">{port.macAddress}</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                                        {getStatusIndicator(port.status)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-sm text-ops-text">{port.speed}</span>
                                            <span className="text-xs text-ops-subtle">{port.mediaType}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col gap-1 items-start">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider
                                                ${port.portMode === 'Trunk' ? 'bg-ops-info-soft text-ops-info dark:bg-ops-info-soft dark:text-ops-info' :
                                                    port.portMode === 'Routed' ? 'bg-ops-orange-soft text-ops-orange dark:bg-ops-orange-soft dark:text-ops-orange' :
                                                        'bg-ops-info-soft text-ops-info dark:bg-ops-info-soft dark:text-ops-info'}`}>
                                                {port.portMode}
                                            </span>

                                            {port.portMode === 'Access' && port.vlanNumber && (
                                                <span className="text-xs text-ops-muted font-medium">VLAN {port.vlanNumber} <span className="text-ops-muted font-normal">({port.vlanName})</span></span>
                                            )}
                                            {port.portMode === 'Trunk' && (
                                                <div className="flex flex-col text-xs text-ops-muted">
                                                    {port.vlanNumber && <span className="text-ops-subtle text-[10px]">Native: {port.vlanNumber}</span>}
                                                    <span className="font-mono">Allowed: {port.trunkVlans || 'All'}</span>
                                                </div>
                                            )}
                                            {port.portMode === 'Routed' && (
                                                <span className="text-xs font-mono font-medium text-ops-muted dark:text-ops-accent bg-ops-surface-raised px-1.5 py-0.5 rounded border border-ops-border">
                                                    {port.ipAddress}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        {port.connectedToDeviceName ? (
                                            <div className="flex flex-col">
                                                <span className="text-ops-text font-medium">{port.connectedToDeviceName}</span>
                                                <span className="text-xs text-ops-subtle font-mono">Port: {port.connectedToPortName || 'Unknown'}</span>
                                            </div>
                                        ) : (
                                            <span className="text-ops-muted italic">Unconnected</span>
                                        )}
                                        {port.description && (
                                            <p className="text-[10px] text-ops-subtle mt-1 max-w-[150px] truncate" title={port.description}>
                                                &quot;{port.description}&quot;
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setEditingPort(port)}
                                                className="text-ops-info hover:text-ops-info dark:hover:text-ops-info p-1 bg-ops-info-soft rounded transition-colors"
                                                title="Edit Port"
                                            >
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeletingPort(port)}
                                                className="text-ops-danger hover:text-ops-danger dark:hover:text-ops-danger p-1 bg-ops-danger-soft rounded transition-colors"
                                                title="Delete Port"
                                            >
                                                <Trash2 className="h-4 w-4" />
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
