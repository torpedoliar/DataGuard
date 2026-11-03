"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getPortsByDevice, updatePort } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { X, Settings2 } from "lucide-react";

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

const fieldClass = "ops-input h-9 w-full px-3 text-sm";
const labelClass = "mb-2 block text-xs font-medium text-ops-muted";

type Port = {
    id: number;
    deviceId: number;
    portName: string;
    portIndex?: number | null;
    macAddress: string | null;
    ipAddress: string | null;
    portMode: string | null;
    vlanId: number | null;
    trunkVlans: string | null;
    status: string | null;
    speed: string | null;
    mediaType: string | null;
    connectedToDeviceId: number | null;
    connectedToPortId: number | null;
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
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [portIndex, setPortIndex] = useState(port.portIndex ? String(port.portIndex) : "");
    const [macAddress, setMacAddress] = useState(port.macAddress || "");
    const [ipAddress, setIpAddress] = useState(port.ipAddress || "");
    const [portMode, setPortMode] = useState(port.portMode || "Access");
    const [vlanId, setVlanId] = useState(port.vlanId ? port.vlanId.toString() : "");
    const [trunkVlans, setTrunkVlans] = useState(port.trunkVlans || "");
    const [status, setStatus] = useState(port.status || "Active");
    const [speed, setSpeed] = useState(port.speed || "1G");
    const [mediaType, setMediaType] = useState(port.mediaType || "Copper (RJ45)");
    const [connectedToDeviceId, setConnectedToDeviceId] = useState(port.connectedToDeviceId ? port.connectedToDeviceId.toString() : "");
    const [connectedToPortId, setConnectedToPortId] = useState(port.connectedToPortId ? port.connectedToPortId.toString() : "");
    const [targetPorts, setTargetPorts] = useState<{ id: number; portName: string }[]>([]);
    const [description, setDescription] = useState(port.description || "");

    const [error, setError] = useState<string | null>(null);

    // Load the target device's ports so the pair can be filled from this side.
    useEffect(() => {
        const id = connectedToDeviceId ? Number.parseInt(connectedToDeviceId, 10) : null;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the port list for "no device" has no external cause to subscribe to
        if (!id) { setTargetPorts([]); return; }
        let alive = true;
        getPortsByDevice(id).then((list) => { if (alive) setTargetPorts(list.map((p) => ({ id: p.id, portName: p.portName }))); });
        return () => { alive = false; };
    }, [connectedToDeviceId]);

    const pickDevice = (value: string) => {
        setConnectedToDeviceId(value);
        setConnectedToPortId("");
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        startTransition(async () => {
            try {
                const targetDeviceId = connectedToDeviceId ? Number.parseInt(connectedToDeviceId, 10) : null;
                await updatePort(port.id, {
                    deviceId,
                    portIndex: portIndex.trim() === "" ? null : Number.parseInt(portIndex, 10),
                    macAddress: macAddress || null,
                    ipAddress: ipAddress || null,
                    portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                    vlanId: vlanId ? parseInt(vlanId) : null,
                    trunkVlans: trunkVlans || null,
                    status: status as "Active" | "Inactive" | "Down",
                    speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                    mediaType: mediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                    connectedToDeviceId: targetDeviceId,
                    // Send both ends: picking the target port here links the pair
                    // from this side alone (updatePort writes the remote back-link).
                    connectedToPortId: connectedToPortId ? Number.parseInt(connectedToPortId, 10) : null,
                    description: description || null,
                });
                router.refresh();
                onClose();
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to update port.");
            }
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
            <div className="my-8 w-full max-w-4xl rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-ops-border p-5">
                    <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                        <Settings2 className="size-4 text-ops-accent" />
                        Modify port {port.portName}
                    </h2>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form onSubmit={handleSubmit} className="p-5">
                    <div className="grid gap-6 md:grid-cols-4 border-b border-ops-border pb-6 mb-6">
                        <div>
                            <label htmlFor="edit-port-slot" className={labelClass}>
                                Slot Faceplate
                            </label>
                            <input
                                id="edit-port-slot"
                                type="number"
                                min={1}
                                value={portIndex}
                                onChange={(e) => setPortIndex(e.target.value)}
                                className={fieldClass}
                                placeholder="Auto dari nama port"
                                disabled={isPending}
                            />
                            <p className="mt-1 text-[11px] text-ops-muted">Kosongkan untuk mengikuti nomor pada nama interface.</p>
                        </div>
                        <div>
                            <label className={labelClass}>
                                MAC Address
                            </label>
                            <input
                                type="text"
                                value={macAddress}
                                onChange={(e) => setMacAddress(e.target.value)}
                                className={fieldClass}
                                placeholder="00:1A:2B:3C:4D:5E"
                                disabled={isPending}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>
                                Port Speed
                            </label>
                            <select
                                value={speed}
                                onChange={(e) => setSpeed(e.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                {["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>
                                Media Type
                            </label>
                            <select
                                value={mediaType}
                                onChange={(e) => setMediaType(e.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                {["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid gap-6 md:grid-cols-4 border-b border-ops-border pb-6 mb-6">
                        <div>
                            <label className={labelClass}>
                                Logical Config
                            </label>
                            <select
                                value={portMode}
                                onChange={(e) => setPortMode(e.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                {["Access", "Trunk", "Routed", "LACP"].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>
                                Access / Native VLAN
                            </label>
                            <select
                                value={vlanId}
                                onChange={(e) => setVlanId(e.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                <option value="">-- No VLAN --</option>
                                {vlans.map(v => <option key={v.id} value={v.id}>{v.vlanId} - {v.name}</option>)}
                            </select>
                        </div>
                        {portMode === "Trunk" && (
                            <div>
                                <label className={labelClass}>
                                    Allowed Trunk VLANs
                                </label>
                                <input
                                    type="text"
                                    value={trunkVlans}
                                    onChange={(e) => setTrunkVlans(e.target.value)}
                                    className={fieldClass}
                                    placeholder="e.g. 10,20,100-200"
                                    disabled={isPending}
                                />
                            </div>
                        )}
                        {portMode === "Routed" && (
                            <div>
                                <label className={labelClass}>
                                    IP Address
                                </label>
                                <input
                                    type="text"
                                    value={ipAddress}
                                    onChange={(e) => setIpAddress(e.target.value)}
                                    className={fieldClass}
                                    placeholder="e.g. 10.0.0.1/30"
                                    disabled={isPending}
                                />
                            </div>
                        )}
                    </div>

                    <div className="grid gap-6 md:grid-cols-3">
                        <div>
                            <label className={labelClass}>
                                Topology / Target Device
                            </label>
                            <select
                                value={connectedToDeviceId}
                                onChange={(e) => pickDevice(e.target.value)}
                                className={fieldClass}
                                disabled={isPending}
                            >
                                <option value="">-- No Connection --</option>
                                {otherDevices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.locationName || "-"})</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>
                                Target Port
                            </label>
                            <select
                                value={connectedToPortId}
                                onChange={(e) => setConnectedToPortId(e.target.value)}
                                className={fieldClass}
                                disabled={isPending || !connectedToDeviceId}
                            >
                                <option value="">{connectedToDeviceId ? "-- Select port --" : "-- Pick a device first --"}</option>
                                {targetPorts.map(p => <option key={p.id} value={p.id}>{p.portName}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>
                                Link Status
                            </label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                className={`${fieldClass} flex items-center`}
                                disabled={isPending}
                            >
                                <option value="Active">Active (Up)</option>
                                <option value="Inactive">Inactive (Admin Down)</option>
                                <option value="Down">Down (No Link)</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>
                                Description
                            </label>
                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
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
                        <ActionButton type="submit" isPending={isPending}>
                            Save configuration
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
