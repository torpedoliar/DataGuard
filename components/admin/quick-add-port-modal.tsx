"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPort } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { Plus, X } from "lucide-react";

type Vlan = { id: number; vlanId: number; name: string };

const fieldClass = "ops-input h-9 w-full px-3 text-sm";
const labelClass = "mb-2 block text-xs font-medium text-ops-muted";

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
    useModalDismiss(onClose, true, !isPending);

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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
            <div className="my-8 w-full max-w-2xl rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-ops-border p-5">
                    <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                            <Plus className="size-4 text-ops-accent" />
                            Provision {slotLabel}
                        </h2>
                        <p className="mt-1 text-[13px] text-ops-muted">
                            Port ini akan dipasang ke slot fisik {slotNumber} pada faceplate.
                        </p>
                    </div>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form onSubmit={handleSubmit} className="p-5">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <label htmlFor="quick-port-name" className={labelClass}>
                                Physical Interface
                            </label>
                            <input
                                id="quick-port-name"
                                type="text"
                                value={portName}
                                onChange={(event) => setPortName(event.target.value)}
                                className={fieldClass}
                                placeholder="e.g. Gi1/0/13"
                                required
                                disabled={isPending}
                            />
                        </div>
                        <div>
                            <label htmlFor="quick-port-status" className={labelClass}>
                                Link Status
                            </label>
                            <select
                                id="quick-port-status"
                                value={status}
                                onChange={(event) => setStatus(event.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                <option value="Active">Active (Up)</option>
                                <option value="Inactive">Inactive (Admin Down)</option>
                                <option value="Down">Down (No Link)</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-speed" className={labelClass}>
                                Port Speed
                            </label>
                            <select
                                id="quick-port-speed"
                                value={speed}
                                onChange={(event) => setSpeed(event.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                {["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"].map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-media" className={labelClass}>
                                Media Type
                            </label>
                            <select
                                id="quick-port-media"
                                value={mediaType}
                                onChange={(event) => setMediaType(event.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                {["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"].map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-mode" className={labelClass}>
                                Logical Config
                            </label>
                            <select
                                id="quick-port-mode"
                                value={portMode}
                                onChange={(event) => setPortMode(event.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                {["Access", "Trunk", "Routed", "LACP"].map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quick-port-vlan" className={labelClass}>
                                Access / Native VLAN
                            </label>
                            <select
                                id="quick-port-vlan"
                                value={vlanId}
                                onChange={(event) => setVlanId(event.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                <option value="">-- No VLAN --</option>
                                {vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>{vlan.vlanId} - {vlan.name}</option>)}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="quick-port-description" className={labelClass}>
                                Description
                            </label>
                            <input
                                id="quick-port-description"
                                type="text"
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                className={fieldClass}
                                placeholder="Uplink to Core"
                                disabled={isPending}
                            />
                        </div>
                    </div>

                    {error && <p className="mt-4 text-[13px] text-ops-danger">{error}</p>}

                    <div className="mt-8 flex justify-end gap-3">
                        <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                            Cancel
                        </ActionButton>
                        <ActionButton type="submit" isPending={isPending} icon={<Plus className="size-4" />}>
                            Add port
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
