"use client";

import { Edit, Trash2 } from "lucide-react";
import { useState } from "react";
import EditPortModal from "./edit-port-modal";
import DeletePortModal from "./delete-port-modal";

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

type Port = {
    id: number;
    deviceId: number;
    portName: string;
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
    deviceId
}: {
    ports: Port[];
    vlans: Vlan[];
    otherDevices: Device[];
    deviceId: number;
}) {
    const [editingPort, setEditingPort] = useState<Port | null>(null);
    const [deletingPort, setDeletingPort] = useState<Port | null>(null);

    const getStatusIndicator = (status: string | null) => {
        if (status === 'Active') return <span className="flex items-center gap-1 text-success"><span className="w-2 h-2 rounded-full bg-success"></span> Active</span>;
        if (status === 'Inactive') return <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-500"></span> Inactive</span>;
        if (status === 'Down') return <span className="flex items-center gap-1 text-error"><span className="w-2 h-2 rounded-full bg-error"></span> Down</span>;
        return <span className="text-slate-400">-</span>;
    };

    return (
        <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Interface</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Media & Speed</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Logical Config</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Topology (Connects To)</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-24">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-card-dark divide-y divide-slate-200 dark:divide-slate-700">
                        {ports.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                                    No ports provisioned for this device.
                                </td>
                            </tr>
                        ) : (
                            ports.map((port) => (
                                <tr key={port.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-slate-900 dark:text-white uppercase tracking-wider">{port.portName}</span>
                                            {port.macAddress && <span className="text-xs text-slate-500 font-mono">{port.macAddress}</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                                        {getStatusIndicator(port.status)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-sm text-slate-800 dark:text-slate-200">{port.speed}</span>
                                            <span className="text-xs text-slate-500">{port.mediaType}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col gap-1 items-start">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider
                                                ${port.portMode === 'Trunk' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' :
                                                    port.portMode === 'Routed' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' :
                                                        'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'}`}>
                                                {port.portMode}
                                            </span>

                                            {port.portMode === 'Access' && port.vlanNumber && (
                                                <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">VLAN {port.vlanNumber} <span className="text-slate-400 font-normal">({port.vlanName})</span></span>
                                            )}
                                            {port.portMode === 'Trunk' && (
                                                <div className="flex flex-col text-xs text-slate-600 dark:text-slate-300">
                                                    {port.vlanNumber && <span className="text-slate-500 text-[10px]">Native: {port.vlanNumber}</span>}
                                                    <span className="font-mono">Allowed: {port.trunkVlans || 'All'}</span>
                                                </div>
                                            )}
                                            {port.portMode === 'Routed' && (
                                                <span className="text-xs font-mono font-medium text-slate-700 dark:text-teal-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                                    {port.ipAddress}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        {port.connectedToDeviceName ? (
                                            <div className="flex flex-col">
                                                <span className="text-slate-800 dark:text-white font-medium">{port.connectedToDeviceName}</span>
                                                <span className="text-xs text-slate-500 font-mono">Port: {port.connectedToPortName || 'Unknown'}</span>
                                            </div>
                                        ) : (
                                            <span className="text-slate-400 italic">Unconnected</span>
                                        )}
                                        {port.description && (
                                            <p className="text-[10px] text-slate-500 mt-1 max-w-[150px] truncate" title={port.description}>
                                                &quot;{port.description}&quot;
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setEditingPort(port)}
                                                className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 p-1 bg-blue-50 dark:bg-blue-900/20 rounded transition-colors"
                                                title="Edit Port"
                                            >
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeletingPort(port)}
                                                className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-1 bg-red-50 dark:bg-red-900/20 rounded transition-colors"
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
