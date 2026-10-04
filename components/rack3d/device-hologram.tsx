"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Link2, PanelRightOpen, X } from "lucide-react";
import { getPortsByDevice, updatePort } from "@/actions/network";
import type { RackDevice } from "@/actions/rack-layout";
import { useDeviceDrawer } from "@/components/admin/device-drawer-sections";
import { buildFaceplate, faceplateSlotColors, isUplinkMedia, isFaceplateConfigured, FACEPLATE_PALETTE, type FaceplateSlot } from "@/lib/faceplate";
import { describeSlot } from "@/components/admin/device-faceplate";

export type FloatPort = Awaited<ReturnType<typeof getPortsByDevice>>[number];

export interface HologramDeviceOption {
    id: number;
    name: string;
    locationName: string | null;
}

type HologramDevice = Pick<RackDevice, "id" | "name" | "ipAddress" | "status" | "openIncidents" | "faceplatePortCount" | "faceplateUplinkCount" | "faceplateRows" | "faceplateNumbering" | "rackPosition" | "rackName" | "locationName">;

interface DeviceHologramProps {
    device: HologramDevice;
    ports: FloatPort[];
    loading: boolean;
    deviceOptions: HologramDeviceOption[];
    onClose: () => void;
    /**
     * Clicked a port that already has a peer: the caller decides what to show
     * (second hologram, rack card, or the peer's network docs). Omitted for the
     * peer's own hologram so it cannot spawn a third one.
     */
    onPickPort?: (port: FloatPort) => void;
    /** A new link was saved; the caller selects the target device. */
    onLinked: (targetDeviceId: number) => void;
    /** Open the full detail panel docked on the right, for this device. */
    onOpenPanel: () => void;
    /** Screen-space vertical offset in rem, from `hologramStagger`. */
    offsetY?: number;
    /** Test seam: render as if this slot were hovered / selected. */
    hoveredSlotKey?: string | null;
    /** Test seam: render as if this slot were hovered / selected. */
    selectedSlotKey?: string | null;
}

const STATUS_DOT: Record<string, string> = {
    OK: "bg-ops-success",
    "NOT OK": "bg-ops-danger",
    Pending: "bg-ops-muted",
};

type HologramSlot = FaceplateSlot<FloatPort>;

// An empty slot has nothing to open: `describeSlot` ends its empty branch with
// "klik untuk provisioning port", which is true on the 2D faceplate but false
// here, so the hologram words empty slots itself.
const emptySlotLabel = (slot: HologramSlot) =>
    slot.block === "uplink" ? `Uplink slot ${slot.slotNumber} — empty` : `Slot ${slot.slotNumber} — empty`;

const slotLabel = (slot: HologramSlot) => (slot.port ? describeSlot(slot) : emptySlotLabel(slot));

// Network-docs hologram floating above the selected device in the 3D scene.
// DOM inside a plain drei <Html> (same proven pattern as the cable labels: no
// distanceFactor, so the pixel size stays constant and the text stays crisp —
// brightness comes from high-contrast tokens + glow, not canvas rasterisation).
// The body is the device's documented faceplate: hovering a slot shows its
// wiring, clicking an occupied one opens its detail panel, and the peer action
// is left to the caller through the optional `onPickPort`.
export function DeviceHologram({ device, ports, loading, deviceOptions, onClose, onPickPort, onLinked, onOpenPanel, offsetY = 0, hoveredSlotKey, selectedSlotKey }: DeviceHologramProps) {
    const linked = ports.filter((p) => p.connectedToDeviceId != null).length;
    const { data: drawer } = useDeviceDrawer(device.id);
    const [linkTarget, setLinkTarget] = useState<FloatPort | null>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const hovered = hoveredSlotKey !== undefined ? hoveredSlotKey : hoveredKey;
    const selected = selectedSlotKey !== undefined ? selectedSlotKey : selectedKey;

    const config = {
        portCount: device.faceplatePortCount,
        uplinkCount: device.faceplateUplinkCount,
        rows: device.faceplateRows,
        numbering: device.faceplateNumbering,
    };
    const configured = isFaceplateConfigured(config);
    const plate = configured ? buildFaceplate(config, ports) : null;
    const slots = plate?.slots ?? [];
    const hoveredSlot = slots.find((s) => s.key === hovered) ?? null;
    const selectedSlot = slots.find((s) => s.key === selected) ?? null;

    const peerOptions = deviceOptions.filter((d) => d.id !== device.id);
    const statusLabel = device.status ?? "Pending";

    const activate = (slot: HologramSlot) => {
        // Empty slots are display only: there is no port to link, and creating
        // ports stays in the network docs.
        if (!slot.port) return;
        setSelectedKey(slot.key);
        if (slot.port.connectedToDeviceId != null) onPickPort?.(slot.port);
    };

    return (
        <div
            className="w-80 rounded-xl border border-ops-accent/40 bg-ops-surface/95 shadow-[0_0_24px_-4px_var(--ops-accent)] backdrop-blur"
            style={offsetY ? { transform: `translateY(${offsetY}rem)` } : undefined}
        >
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

            <div className="max-h-56 overflow-auto px-3 py-2">
                {loading ? (
                    <p className="py-2 text-center text-xs text-ops-muted">Loading ports…</p>
                ) : !plate ? (
                    <p className="space-y-1 py-2 text-center text-xs text-ops-muted">
                        <span className="block">Faceplate not configured.</span>
                        <Link href={`/admin/devices/${device.id}/network`} className="font-semibold text-ops-accent hover:underline">
                            Set it up in Full Docs
                        </Link>
                    </p>
                ) : (
                    <>
                        <svg
                            viewBox={`0 0 ${plate.width} ${plate.height}`}
                            // A 4-port plate would be a stamp in a 320px card, so it
                            // stretches to the card; a 48-port plate keeps its
                            // intrinsic width and scrolls instead of shrinking its
                            // slots below a hoverable size.
                            style={{ width: "100%", minWidth: `${plate.width}px` }}
                            role="group"
                            aria-label={`Faceplate ${device.name}, ${plate.slots.length} slots`}
                        >
                            <rect x={0} y={0} width={plate.width} height={plate.height} rx={3} fill={FACEPLATE_PALETTE.chassis.fill} stroke={FACEPLATE_PALETTE.chassis.stroke} strokeWidth={0.8} />
                            {plate.blocks.map((block) => (
                                <text key={block.block} x={block.x} y={block.labelY} fontSize={6} fill="#94a3b8" fontFamily="monospace">{block.label}</text>
                            ))}
                            {plate.slots.map((slot) => {
                                const colors = faceplateSlotColors(slot.port);
                                const uplinkSlot = slot.block === "uplink" || isUplinkMedia(slot.port?.mediaType);
                                const isHovered = hovered === slot.key;
                                const label = slotLabel(slot);
                                return (
                                    <g
                                        key={slot.key}
                                        role={slot.port ? "button" : undefined}
                                        tabIndex={slot.port ? 0 : undefined}
                                        aria-label={label}
                                        className={slot.port ? "cursor-pointer" : undefined}
                                        onClick={() => activate(slot)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                activate(slot);
                                            }
                                        }}
                                        onMouseEnter={() => setHoveredKey(slot.key)}
                                        onMouseLeave={() => setHoveredKey((cur) => (cur === slot.key ? null : cur))}
                                        onFocus={() => setHoveredKey(slot.key)}
                                        onBlur={() => setHoveredKey((cur) => (cur === slot.key ? null : cur))}
                                    >
                                        <title>{label}</title>
                                        <rect
                                            x={slot.x}
                                            y={slot.y}
                                            width={slot.width}
                                            height={slot.height}
                                            rx={1.5}
                                            fill={colors.fill}
                                            stroke={isHovered ? "#f8fafc" : colors.stroke}
                                            strokeWidth={isHovered ? 1.4 : 0.7}
                                            strokeDasharray={slot.port ? undefined : "2 1.5"}
                                        />
                                        {uplinkSlot ? (
                                            <rect x={slot.x + 3} y={slot.y + slot.height / 2 - 1.5} width={slot.width - 6} height={3} rx={0.6} fill="#000000" opacity={0.35} />
                                        ) : (
                                            <rect x={slot.x + slot.width / 2 - 3} y={slot.y + slot.height - 4.5} width={6} height={3} rx={0.5} fill="#000000" opacity={0.3} />
                                        )}
                                        {colors.accent && <rect x={slot.x} y={slot.y} width={2} height={slot.height} rx={1} fill={colors.accent} />}
                                        {slot.port?.connectedToPortId && (
                                            <circle cx={slot.x + slot.width - 2.6} cy={slot.y + 2.6} r={1.3} fill="#f8fafc" opacity={0.85} />
                                        )}
                                        <text
                                            x={slot.x + slot.width / 2}
                                            y={slot.y + slot.height / 2 + 1}
                                            textAnchor="middle"
                                            fontSize={7}
                                            fontFamily="monospace"
                                            fontWeight={600}
                                            fill={colors.label}
                                            pointerEvents="none"
                                        >
                                            {slot.slotNumber}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                        {plate.unplaced.length > 0 && (
                            <p className="mt-1 text-[11px] text-ops-muted">{plate.unplaced.length} port not on the faceplate</p>
                        )}
                    </>
                )}
            </div>

            {hoveredSlot && (
                <div className="border-b border-ops-border bg-ops-bg/60 px-3 py-1.5 text-[11px] text-ops-text">
                    <span className="block truncate">{slotLabel(hoveredSlot)}</span>
                </div>
            )}

            {selectedSlot?.port && (
                <div className="space-y-1 border-b border-ops-border bg-ops-bg/60 px-3 py-2 text-[11px]">
                    <p className="font-mono font-semibold text-ops-text">{selectedSlot.port.portName}</p>
                    <p className="text-ops-muted">{selectedSlot.port.status ?? "Status not set"}{selectedSlot.port.portMode ? ` · ${selectedSlot.port.portMode}` : ""}</p>
                    {(selectedSlot.port.speed || selectedSlot.port.mediaType) && (
                        <p className="text-ops-muted">{[selectedSlot.port.speed, selectedSlot.port.mediaType].filter(Boolean).join(" ")}</p>
                    )}
                    {selectedSlot.port.trunkVlans && <p className="text-ops-muted">Trunk: {selectedSlot.port.trunkVlans}</p>}
                    {selectedSlot.port.description && <p className="text-ops-muted">&ldquo;{selectedSlot.port.description}&rdquo;</p>}
                    <p className={selectedSlot.port.connectedToDeviceId != null ? "text-ops-text" : "text-ops-muted"}>
                        {selectedSlot.port.connectedToDeviceId != null
                            ? `→ ${selectedSlot.port.connectedToDeviceName ?? "unknown"}${selectedSlot.port.connectedToPortName ? ` :${selectedSlot.port.connectedToPortName}` : ""}`
                            : "Not linked"}
                    </p>
                    <div className="flex justify-end gap-2 pt-0.5">
                        <button
                            type="button"
                            onClick={() => setSelectedKey(null)}
                            className="rounded-md border border-ops-border px-2 py-1 text-ops-text hover:bg-ops-surface-raised"
                        >
                            Tutup
                        </button>
                        <button
                            type="button"
                            onClick={() => setLinkTarget(selectedSlot.port)}
                            className="flex items-center gap-1 rounded-md bg-ops-accent px-2 py-1 font-semibold text-white hover:opacity-90"
                        >
                            <Link2 className="size-3" /> Edit link
                        </button>
                    </div>
                </div>
            )}

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
                    onSaved={(targetDeviceId) => { setLinkTarget(null); setSelectedKey(null); onLinked(targetDeviceId); }}
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
