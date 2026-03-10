"use client";

import { useState, useTransition } from "react";
import { addPort, bulkAddPorts } from "@/actions/network";
import { Plus, Loader2, Layers, Info } from "lucide-react";

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

export default function AddPortForm({
    deviceId,
    vlans,
    otherDevices
}: {
    deviceId: number;
    vlans: Vlan[];
    otherDevices: Device[];
}) {
    const [isPending, startTransition] = useTransition();
    const [portName, setPortName] = useState("");
    const [macAddress, setMacAddress] = useState("");
    const [ipAddress, setIpAddress] = useState("");
    const [portMode, setPortMode] = useState("Access");
    const [vlanId, setVlanId] = useState("");
    const [trunkVlans, setTrunkVlans] = useState("");
    const [status, setStatus] = useState("Active");
    const [speed, setSpeed] = useState("1G");
    const [mediaType, setMediaType] = useState("Copper (RJ45)");
    const [connectedToDeviceId, setConnectedToDeviceId] = useState("");
    const [description, setDescription] = useState("");

    const [isBulk, setIsBulk] = useState(false);
    const [portPrefix, setPortPrefix] = useState("");
    const [portStart, setPortStart] = useState("1");
    const [portEnd, setPortEnd] = useState("24");

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!isBulk && !portName) {
            setError("Port Name is required.");
            return;
        }

        if (isBulk) {
            const start = parseInt(portStart);
            const end = parseInt(portEnd);
            if (isNaN(start) || isNaN(end) || start > end) {
                setError("Invalid port range.");
                return;
            }
            if (end - start > 100) {
                setError("Maximum 100 ports can be added at once.");
                return;
            }
        }

        startTransition(async () => {
            try {
                if (isBulk) {
                    const start = parseInt(portStart);
                    const end = parseInt(portEnd);
                    const ports = [];

                    for (let i = start; i <= end; i++) {
                        ports.push({
                            deviceId,
                            portName: `${portPrefix}${i}`,
                            portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                            vlanId: vlanId ? parseInt(vlanId) : null,
                            trunkVlans: trunkVlans || null,
                            status: status as "Active" | "Inactive" | "Down",
                            speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                            mediaType: mediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                            description: description || null,
                        });
                    }

                    await bulkAddPorts(ports);
                    setSuccess(`${ports.length} ports added successfully!`);
                } else {
                    await addPort({
                        deviceId,
                        portName,
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
                    setSuccess("Port definition added successfully!");
                }

                // Reset common fields
                setPortName("");
                setMacAddress("");
                setIpAddress("");
                setTrunkVlans("");
                setConnectedToDeviceId("");
                setDescription("");
                setTimeout(() => setSuccess(null), 3000);
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to add port(s).");
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <Plus className="h-5 w-5 text-teal-500" />
                    Provision New Port
                </h3>
                <div
                    onClick={() => setIsBulk(!isBulk)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
                >
                    <Layers className={`h-4 w-4 ${isBulk ? 'text-teal-500' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Bulk Mode</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${isBulk ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isBulk ? 'left-4.5' : 'left-0.5'}`} />
                    </div>
                </div>
            </div>

            {isBulk && (
                <div className="mb-6 p-4 bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-900/30 rounded-lg flex gap-3">
                    <Info className="h-5 w-5 text-teal-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-teal-800 dark:text-teal-200">
                        <strong>Bulk Mode Active:</strong> Generates ports based on a numeric range. MAC, IP, and Topology settings are disabled for bulk addition as they are unique to each port.
                    </p>
                </div>
            )}

            <div className={`grid gap-6 ${isBulk ? 'md:grid-cols-3' : 'md:grid-cols-4'} border-b border-slate-200 dark:border-slate-700 pb-6 mb-6`}>
                {!isBulk ? (
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                            Physical Interface
                        </label>
                        <input
                            type="text"
                            value={portName}
                            onChange={(e) => setPortName(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                            placeholder="e.g. Gi1/0/1 or eth0"
                            required
                            disabled={isPending}
                        />
                    </div>
                ) : (
                    <>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Port Name Prefix
                            </label>
                            <input
                                type="text"
                                value={portPrefix}
                                onChange={(e) => setPortPrefix(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                placeholder="e.g. Gi1/0/"
                                required
                                disabled={isPending}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                    Start Range
                                </label>
                                <input
                                    type="number"
                                    value={portStart}
                                    onChange={(e) => setPortStart(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                    min="0"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                    End Range
                                </label>
                                <input
                                    type="number"
                                    value={portEnd}
                                    onChange={(e) => setPortEnd(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                    min="1"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>
                    </>
                )}

                {!isBulk && (
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
                )}
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

            <div className={`grid gap-6 ${isBulk ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                {!isBulk && (
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
                )}
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
            {success && <p className="mt-4 text-sm text-green-500">{success}</p>}

            <div className="mt-8 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="flex items-center gap-2 bg-teal-600 text-white px-6 py-2 rounded-md hover:bg-teal-700 transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    Add Port
                </button>
            </div>
        </form>
    );
}
