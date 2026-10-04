"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Link2, PanelRightOpen, X } from "lucide-react";
import { getPortsByDevice, updatePort } from "@/actions/network";
import type { RackDevice } from "@/actions/rack-layout";
import { useDeviceDrawer } from "@/components/admin/device-drawer-sections";

export type FloatPort = Awaited<ReturnType<typeof getPortsByDevice>>[number];

export interface HologramDeviceOption {
    id: number;
    name: string;
    locationName: string | null;
}

interface DeviceHologramProps {
    device: Pick<RackDevice, "id" | "name" | "ipAddress" | "status" | "openIncidents">;
    ports: FloatPort[];
    loading: boolean;
    deviceOptions: HologramDeviceOption[];
    onClose: () => void;
    /** Clicked a wired port: fly to its peer. */
    onPickPort: (port: FloatPort) => void;
    /** A new link was saved; the caller selects the target device. */
    onLinked: (targetDeviceId: number) => void;
    /** Open the full detail panel docked on the right. */
    onOpenPanel: () => void;
}

const STATUS_DOT: Record<string, string> = {
    OK: "bg-ops-success",
    "NOT OK": "bg-ops-danger",
    Pending: "bg-ops-muted",
};

// Network-docs hologram floating above the selected device in the 3D scene.
// DOM inside a plain drei <Html> (same proven pattern as the cable labels: no
// distanceFactor, so the pixel size stays constant and the text stays crisp —
// brightness comes from high-contrast tokens + glow, not canvas rasterisation).
// A wired port flies to its peer; an empty port opens the one-dialog link form.
export function DeviceHologram({ device, ports, loading, deviceOptions, onClose, onPickPort, onLinked, onOpenPanel }: DeviceHologramProps) {
    const linked = ports.filter((p) => p.connectedToDeviceId != null).length;
    const { data: drawer } = useDeviceDrawer(device.id);
    const [linkTarget, setLinkTarget] = useState<FloatPort | null>(null);

    const peerOptions = deviceOptions.filter((d) => d.id !== device.id);
    const statusLabel = device.status ?? "Pending";

    return (
        <div className="w-72 rounded-xl border border-ops-accent/40 bg-ops-surface/95 shadow-[0_0_24px_-4px_var(--ops-accent)] backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-ops-border px-3 py-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ops-text">{device.name}</p>
                    <p className="truncate font-mono text-[11px] text-ops-muted">{device.ipAddress ?? "no IP"}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={`Close ${device.name} hologram`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text"
                >
                    <X className="size-3.5" />
                </button>
            </div>

            <div className="space-y-1 border-b border-ops-border px-3 py-2 text-[11px]">
                <p className="flex items-center gap-1.5 text-ops-text">
                    <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[statusLabel] ?? "bg-ops-muted"}`} />
                    <span className="font-semibold">{statusLabel}</span>
                    {device.openIncidents.count > 0 && (
                        <span className="ml-auto rounded px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: "var(--ops-danger)" }}>
                            {device.openIncidents.count} incident{device.openIncidents.count > 1 ? "s" : ""}
                        </span>
                    )}
                </p>
                <p className="text-ops-muted">
                    Audit:{" "}
                    {drawer ? (
                        drawer.lastAudit
                            ? <span className="text-ops-text">{drawer.lastAudit.checkDate} · {drawer.lastAudit.status}</span>
                            : "never audited"
                    ) : "…"}
                </p>
                <p className="text-ops-muted">
                    SIEM:{" "}
                    {drawer ? (
                        drawer.siem.count > 0
                            ? <span className="font-semibold text-ops-warning">{drawer.siem.count} open</span>
                            : "clear"
                    ) : "…"}
                </p>
            </div>

            <div className="max-h-56 overflow-y-auto px-3 py-2">
                {loading ? (
                    <p className="py-2 text-center text-xs text-ops-muted">Loading ports…</p>
                ) : ports.length === 0 ? (
                    <p className="py-2 text-center text-xs text-ops-muted">No ports documented.</p>
                ) : (
                    <ul className="space-y-1">
                        {ports.map((p) => {
                            const wired = p.connectedToDeviceId != null;
                            return (
                                <li key={p.id}>
                                    <button
                                        type="button"
                                        onClick={() => { if (wired) onPickPort(p); else setLinkTarget(p); }}
                                        aria-label={wired ? `Port ${p.portName} to ${p.connectedToDeviceName}` : `Link port ${p.portName} to a target device`}
                                        className="flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-ops-surface-raised"
                                    >
                                        <span className={`size-1.5 shrink-0 rounded-full ${p.status === "Active" ? "bg-ops-success" : "bg-ops-muted"}`} />
                                        <span className="font-mono font-semibold text-ops-text">{p.portName}</span>
                                        {p.vlanNumber != null && <span className="font-mono text-[10px] text-ops-accent">VLAN {p.vlanNumber}</span>}
                                        <span className={`truncate ${wired ? "text-ops-text" : "text-ops-muted"}`}>
                                            {wired ? `→ ${p.connectedToDeviceName}${p.connectedToPortName ? ` :${p.connectedToPortName}` : ""}` : "Not linked"}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-ops-border px-3 py-2">
                <span className="font-mono text-[11px] text-ops-success">{linked}/{ports.length} Linked</span>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onOpenPanel}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-text hover:bg-ops-surface-raised"
                    >
                        <PanelRightOpen className="size-3" /> Panel
                    </button>
                    <Link
                        href={`/admin/devices/${device.id}/network`}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ops-accent hover:bg-ops-accent/10"
                    >
                        Full Docs <ExternalLink className="size-3" />
                    </Link>
                </div>
            </div>

            {linkTarget && (
                <PortLinkDialog
                    port={linkTarget}
                    deviceOptions={peerOptions}
                    onClose={() => setLinkTarget(null)}
                    onSaved={(targetDeviceId) => { setLinkTarget(null); onLinked(targetDeviceId); }}
                />
            )}
        </div>
    );
}

// One dialog: pick the target device and its port, save. updatePort writes both
// ends, so the pair is documented from this side alone.
function PortLinkDialog({ port, deviceOptions, onClose, onSaved }: {
    port: FloatPort;
    deviceOptions: HologramDeviceOption[];
    onClose: () => void;
    onSaved: (targetDeviceId: number) => void;
}) {
    const [targetDeviceId, setTargetDeviceId] = useState("");
    const [targetPortId, setTargetPortId] = useState("");
    const [targetPorts, setTargetPorts] = useState<{ id: number; portName: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const id = targetDeviceId ? Number.parseInt(targetDeviceId, 10) : null;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the port list for "no device" has no external cause to subscribe to
        if (!id) { setTargetPorts([]); return; }
        let alive = true;
        getPortsByDevice(id)
            .then((list) => { if (alive) setTargetPorts(list.map((p) => ({ id: p.id, portName: p.portName }))); })
            .catch(() => { if (alive) setTargetPorts([]); });
        return () => { alive = false; };
    }, [targetDeviceId]);

    const pickDevice = (value: string) => {
        setTargetDeviceId(value);
        setTargetPortId("");
    };

    const save = async () => {
        const deviceId = Number.parseInt(targetDeviceId, 10);
        const portId = Number.parseInt(targetPortId, 10);
        if (!deviceId || !portId) { setError("Pilih perangkat tujuan dan portnya."); return; }
        setSaving(true);
        setError(null);
        try {
            await updatePort(port.id, { deviceId: port.deviceId, connectedToDeviceId: deviceId, connectedToPortId: portId });
            onSaved(deviceId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan link.");
            setSaving(false);
        }
    };

    return (
        <div role="dialog" aria-label={`Link port ${port.portName}`} className="mt-2 space-y-2 rounded-lg border border-ops-accent/40 bg-ops-bg/95 p-2 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-ops-text">
                <Link2 className="size-3.5" /> Link {port.portName} to…
            </p>
            <label className="block space-y-1">
                <span className="text-ops-muted">Target device</span>
                <select value={targetDeviceId} onChange={(e) => pickDevice(e.target.value)} className="h-8 w-full rounded-md border border-ops-border bg-ops-bg px-2 text-xs text-ops-text">
                    <option value="">-- Select device --</option>
                    {deviceOptions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.locationName || "-"})</option>)}
                </select>
            </label>
            <label className="block space-y-1">
                <span className="text-ops-muted">Target port</span>
                <select value={targetPortId} onChange={(e) => setTargetPortId(e.target.value)} disabled={!targetDeviceId} className="h-8 w-full rounded-md border border-ops-border bg-ops-bg px-2 text-xs text-ops-text disabled:opacity-60">
                    <option value="">{targetDeviceId ? "-- Select port --" : "-- Pick a device first --"}</option>
                    {targetPorts.map((p) => <option key={p.id} value={p.id}>{p.portName}</option>)}
                </select>
            </label>
            {error && <p role="alert" className="text-[11px] text-ops-danger">{error}</p>}
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded-md border border-ops-border px-2 py-1 text-ops-text hover:bg-ops-surface-raised">Cancel</button>
                <button type="button" onClick={save} disabled={saving || !targetDeviceId || !targetPortId} className="rounded-md bg-ops-accent px-2 py-1 font-semibold text-white disabled:opacity-60">
                    {saving ? "Saving…" : "Save link"}
                </button>
            </div>
        </div>
    );
}
