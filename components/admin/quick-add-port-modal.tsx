"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPort } from "@/actions/network";
import { Loader2, Plus, X } from "lucide-react";

type Vlan = { id: number; vlanId: number; name: string };

export default function QuickAddPortModal({
    deviceId,
    slotNumber,
    slotLabel,
    suggestedName,
    isUplinkSlot,
    vlans,
    onClose,
}: {
    deviceId: number;
    slotNumber: number;
    slotLabel: string;
    suggestedName: string;
    isUplinkSlot: boolean;
    vlans: Vlan[];
    onClose: () => void;
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [portName, setPortName] = useState(suggestedName);
    const [status, setStatus] = useState("Active");
    const [speed, setSpeed] = useState(isUplinkSlot ? "10G" : "1G");
    const [mediaType, setMediaType] = useState(isUplinkSlot ? "Fiber (SFP/SFP+)" : "Copper (RJ45)");
    const [portMode, setPortMode] = useState(isUplinkSlot ? "Trunk" : "Access");
    const [vlanId, setVlanId] = useState("");
    const [description, setDescription] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!portName.trim()) {
            setError("Nama interface wajib diisi.");
            return;
        }

        startTransition(async () => {
            try {
                await addPort({
                    deviceId,
                    portName: portName.trim(),
                    portIndex: slotNumber,
                    portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                    vlanId: vlanId ? Number.parseInt(vlanId, 10) : null,
                    status: status as "Active" | "Inactive" | "Down",
                    speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                    mediaType: mediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                    description: description || null,
                });
                router.refresh();
                onClose();
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Gagal menambahkan port.");
            }
        });
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white dark:bg-slate-800 rounded-xl max-w-2xl w-full shadow-xl my-8">
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <div>
                        <h2 className="text-xl font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                            <Plus className="h-5 w-5 text-teal-500" />
                            Provision {slotLabel}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Port ini akan dipasang ke slot fisik {slotNumber} pada faceplate.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                        aria-label="Tutup"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <label htmlFor="quick-port-name" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Physical Interface
                            </label>
                            <input
                                id="quick-port-name"
                                type="text"
                                value={portName}
                                onChange={(event) => setPortName(event.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                placeholder="e.g. Gi1/0/13"
                                required
                                disabled={isPending}
                            />
                        </div>
                        <div>
                            <label htmlFor="quick-port-status" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Link Status
                            </label>
                            <select
                                id="quick-port-status"
                                value={status}
                                onChange={(event) => setStatus(event.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                <option value="Active">Active (Up)</option>
                                <option value="Inactive">Inactive (Admin Down)</option>
                                <option value="Down">Down (No Link)</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-speed" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Port Speed
                            </label>
                            <select
                                id="quick-port-speed"
                                value={speed}
                                onChange={(event) => setSpeed(event.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                {["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"].map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-media" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Media Type
                            </label>
                            <select
                                id="quick-port-media"
                                value={mediaType}
                                onChange={(event) => setMediaType(event.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                {["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"].map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-mode" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Logical Config
                            </label>
                            <select
                                id="quick-port-mode"
                                value={portMode}
                                onChange={(event) => setPortMode(event.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                {["Access", "Trunk", "Routed", "LACP"].map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-vlan" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Access / Native VLAN
                            </label>
                            <select
                                id="quick-port-vlan"
                                value={vlanId}
                                onChange={(event) => setVlanId(event.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            >
                                <option value="">-- No VLAN --</option>
                                {vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>{vlan.vlanId} - {vlan.name}</option>)}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="quick-port-description" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Description
                            </label>
                            <input
                                id="quick-port-description"
                                type="text"
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
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
                            {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                            Add Port
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
