"use client";

import { useState, useTransition } from "react";
import { updatePort } from "@/actions/network";
import { Loader2, X, Settings2 } from "lucide-react";

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
    trunkVlans: string | null;
    status: string | null;
    speed: string | null;
    mediaType: string | null;
    connectedToDeviceId: number | null;
    description: string | null;
};

export default function EditPortModal({
    port,
    vlans,
    otherDevices,
    onClose,
    deviceId
}: {
    port: Port;
    vlans: Vlan[];
    otherDevices: Device[];
    onClose: () => void;
    deviceId: number;
}) {
    const [isPending, startTransition] = useTransition();
    const [macAddress, setMacAddress] = useState(port.macAddress || "");
    const [ipAddress, setIpAddress] = useState(port.ipAddress || "");
    const [portMode, setPortMode] = useState(port.portMode || "Access");
    const [vlanId, setVlanId] = useState(port.vlanId ? port.vlanId.toString() : "");
    const [trunkVlans, setTrunkVlans] = useState(port.trunkVlans || "");
    const [status, setStatus] = useState(port.status || "Active");
    const [speed, setSpeed] = useState(port.speed || "1G");
    const [mediaType, setMediaType] = useState(port.mediaType || "Copper (RJ45)");
    const [connectedToDeviceId, setConnectedToDeviceId] = useState(port.connectedToDeviceId ? port.connectedToDeviceId.toString() : "");
    const [description, setDescription] = useState(port.description || "");

    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        startTransition(async () => {
            try {
                await updatePort(port.id, {
                    deviceId,
                    macAddress: macAddress || null,
                    ipAddress: ipAddress || null,
                    portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                    vlanId: vlanId ? parseInt(vlanId) : null,
                    trunkVlans: trunkVlans || null,
                    status: status as "Active" | "Inactive" | "Down",
                    speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                    mediaType: mediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                    connectedToDeviceId: connectedToDeviceId ? parseInt(connectedToDeviceId) : null,
                    description: description || null,
                });
                onClose();
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to update port.");
            }
        });
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white dark:bg-slate-800 rounded-xl max-w-4xl w-full shadow-xl my-8">
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <Settings2 className="h-5 w-5 text-teal-500" />
                        Modify Port {port.portName}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="grid gap-6 md:grid-cols-3 border-b border-slate-200 dark:border-slate-700 pb-6 mb-6">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                MAC Address
                            </label>
                            <input
                                type="text"
                                value={macAddress}
                                onChange={(e) => setMacAddress(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                placeholder="00:1A:2B:3C:4D:5E"
                                disabled={isPending}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Port Speed
                            </label>
                            <select
                                value={speed}
                                onChange={(e) => setSpeed(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                {["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Media Type
                            </label>
                            <select
                                value={mediaType}
                                onChange={(e) => setMediaType(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                {["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid gap-6 md:grid-cols-4 border-b border-slate-200 dark:border-slate-700 pb-6 mb-6">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Logical Config
                            </label>
                            <select
                                value={portMode}
                                onChange={(e) => setPortMode(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                {["Access", "Trunk", "Routed", "LACP"].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Access / Native VLAN
                            </label>
                            <select
                                value={vlanId}
                                onChange={(e) => setVlanId(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                <option value="">-- No VLAN --</option>
                                {vlans.map(v => <option key={v.id} value={v.id}>{v.vlanId} - {v.name}</option>)}
                            </select>
                        </div>
                        {portMode === "Trunk" && (
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                    Allowed Trunk VLANs
                                </label>
                                <input
                                    type="text"
                                    value={trunkVlans}
                                    onChange={(e) => setTrunkVlans(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                    placeholder="e.g. 10,20,100-200"
                                    disabled={isPending}
                                />
                            </div>
                        )}
                        {portMode === "Routed" && (
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                    IP Address
                                </label>
                                <input
                                    type="text"
                                    value={ipAddress}
                                    onChange={(e) => setIpAddress(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                    placeholder="e.g. 10.0.0.1/30"
                                    disabled={isPending}
                                />
                            </div>
                        )}
                    </div>

                    <div className="grid gap-6 md:grid-cols-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Topology / Target Device
                            </label>
                            <select
                                value={connectedToDeviceId}
                                onChange={(e) => setConnectedToDeviceId(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                <option value="">-- No Connection --</option>
                                {otherDevices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.locationName || "-"})</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Link Status
                            </label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white flex items-center"
                                disabled={isPending}
                            >
                                <option value="Active">🟢 Active (Up)</option>
                                <option value="Inactive">⚫ Inactive (Admin Down)</option>
                                <option value="Down">🔴 Down (No Link)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Description
                            </label>
                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                placeholder="Uplink to Core"
                                disabled={isPending}
                            />
                        </div>
                    </div>

                    {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

                    <div className="mt-8 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isPending}
                            className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex items-center gap-2 bg-teal-600 text-white px-6 py-2 rounded-md hover:bg-teal-700 transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50"
                        >
                            {isPending && <Loader2 className="animate-spin h-5 w-5" />}
                            Save Configuration
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
