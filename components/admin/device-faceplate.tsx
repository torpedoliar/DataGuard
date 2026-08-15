"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    buildFaceplate,
    faceplateSlotColors,
    isUplinkMedia,
    suggestPortName,
    FACEPLATE_PALETTE,
    type FaceplateConfigInput,
    type FaceplateSlot,
} from "@/lib/faceplate";
import { updatePortSlot } from "@/actions/network";
import EditPortModal from "./edit-port-modal";
import QuickAddPortModal from "./quick-add-port-modal";
import { AlertTriangle, Cable, Loader2, MousePointerClick, Network } from "lucide-react";

export type NetworkPortRow = {
    id: number;
    deviceId: number;
    portName: string;
    portIndex: number | null;
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

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

type Slot = FaceplateSlot<NetworkPortRow>;

/** One-line summary of a port, used for the hover detail strip and tooltips. */
export function describeSlot(slot: Slot): string {
    const label = slot.block === "uplink" ? `Uplink slot ${slot.slotNumber}` : `Slot ${slot.slotNumber}`;
    if (!slot.port) return `${label} — kosong, klik untuk provisioning port`;

    const port = slot.port;
    const parts = [port.portName, port.status ?? "Status belum diisi"];
    if (port.speed || port.mediaType) parts.push([port.speed, port.mediaType].filter(Boolean).join(" "));
    if (port.portMode === "Access" && port.vlanNumber) parts.push(`VLAN ${port.vlanNumber}${port.vlanName ? ` (${port.vlanName})` : ""}`);
    else if (port.portMode === "Trunk") parts.push(`Trunk: ${port.trunkVlans || "All"}`);
    else if (port.portMode === "Routed" && port.ipAddress) parts.push(port.ipAddress);
    else if (port.portMode) parts.push(port.portMode);
    if (port.connectedToDeviceName) parts.push(`→ ${port.connectedToDeviceName} ${port.connectedToPortName ?? ""}`.trim());
    if (port.description) parts.push(`"${port.description}"`);

    return `${label} — ${parts.join(" · ")}`;
}

function UnplacedPortRow({ port, maxSlot }: { port: NetworkPortRow; maxSlot: number }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [slot, setSlot] = useState(port.portIndex ? String(port.portIndex) : "");
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        const parsed = Number.parseInt(slot, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxSlot) {
            setError(`Slot harus antara 1 dan ${maxSlot}.`);
            return;
        }
        setError(null);
        startTransition(async () => {
            try {
                await updatePortSlot(port.id, parsed);
                router.refresh();
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Gagal menyimpan slot.");
            }
        });
    };

    return (
        <li className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="font-mono text-xs font-semibold text-slate-800 dark:text-white min-w-24">{port.portName}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-32">
                {port.mediaType || "Media belum diisi"}
            </span>
            <label className="text-xs text-slate-500 dark:text-slate-400" htmlFor={`slot-${port.id}`}>
                Slot
            </label>
            <input
                id={`slot-${port.id}`}
                type="number"
                min={1}
                max={maxSlot}
                value={slot}
                onChange={(event) => setSlot(event.target.value)}
                disabled={isPending}
                className="w-20 px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
            />
            <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Pasang
            </button>
            {error && <span className="text-xs text-red-500 w-full">{error}</span>}
        </li>
    );
}

export default function DeviceFaceplate({
    deviceId,
    deviceName,
    config,
    ports,
    vlans,
    otherDevices,
}: {
    deviceId: number;
    deviceName: string;
    config: FaceplateConfigInput;
    ports: NetworkPortRow[];
    vlans: Vlan[];
    otherDevices: Device[];
}) {
    const faceplate = useMemo(() => buildFaceplate<NetworkPortRow>(config, ports), [config, ports]);
    const [hovered, setHovered] = useState<Slot | null>(null);
    const [editingPort, setEditingPort] = useState<NetworkPortRow | null>(null);
    const [addingSlot, setAddingSlot] = useState<Slot | null>(null);

    const totalSlots = faceplate.config.portCount + faceplate.config.uplinkCount;
    const occupied = faceplate.slots.filter((slot) => slot.port).length;
    const existingNames = useMemo(() => ports.map((port) => port.portName), [ports]);

    if (totalSlots === 0) {
        return (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-6 text-center">
                <Network className="h-6 w-6 mx-auto text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">Faceplate belum dikonfigurasi</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Isi jumlah port fisik perangkat ini pada panel &quot;Faceplate Layout&quot; untuk menggambar diagram port.
                </p>
            </div>
        );
    }

    const handleSlotActivate = (slot: Slot) => {
        if (slot.port) setEditingPort(slot.port);
        else setAddingSlot(slot);
    };

    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <Cable className="h-4 w-4 text-teal-500" />
                        {deviceName} Faceplate
                    </h4>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        {occupied} / {totalSlots} slot terdokumentasi
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <svg
                        viewBox={`0 0 ${faceplate.width} ${faceplate.height}`}
                        className="w-full h-auto"
                        style={{ minWidth: Math.min(faceplate.width * 2.2, 900) }}
                        role="group"
                        aria-label={`Diagram faceplate ${deviceName}, ${totalSlots} slot port`}
                    >
                        <rect
                            x={0}
                            y={0}
                            width={faceplate.width}
                            height={faceplate.height}
                            rx={3}
                            fill={FACEPLATE_PALETTE.chassis.fill}
                            stroke={FACEPLATE_PALETTE.chassis.stroke}
                            strokeWidth={0.8}
                        />

                        {faceplate.blocks.map((block) => (
                            <text
                                key={block.block}
                                x={block.x}
                                y={block.labelY}
                                fontSize={6}
                                fill="#94a3b8"
                                fontFamily="monospace"
                            >
                                {block.label}
                            </text>
                        ))}

                        {faceplate.slots.map((slot) => {
                            const colors = faceplateSlotColors(slot.port);
                            const isUplinkSlot = slot.block === "uplink" || isUplinkMedia(slot.port?.mediaType);
                            const isHovered = hovered?.key === slot.key;

                            return (
                                <g
                                    key={slot.key}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={describeSlot(slot)}
                                    className="cursor-pointer"
                                    onClick={() => handleSlotActivate(slot)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            handleSlotActivate(slot);
                                        }
                                    }}
                                    onMouseEnter={() => setHovered(slot)}
                                    onMouseLeave={() => setHovered((current) => (current?.key === slot.key ? null : current))}
                                    onFocus={() => setHovered(slot)}
                                    onBlur={() => setHovered((current) => (current?.key === slot.key ? null : current))}
                                >
                                    <title>{describeSlot(slot)}</title>

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

                                    {isUplinkSlot ? (
                                        <rect
                                            x={slot.x + 3}
                                            y={slot.y + slot.height / 2 - 1.5}
                                            width={slot.width - 6}
                                            height={3}
                                            rx={0.6}
                                            fill="#000000"
                                            opacity={0.35}
                                        />
                                    ) : (
                                        <rect
                                            x={slot.x + slot.width / 2 - 3}
                                            y={slot.y + slot.height - 4.5}
                                            width={6}
                                            height={3}
                                            rx={0.5}
                                            fill="#000000"
                                            opacity={0.3}
                                        />
                                    )}

                                    {colors.accent && (
                                        <rect
                                            x={slot.x}
                                            y={slot.y}
                                            width={2}
                                            height={slot.height}
                                            rx={1}
                                            fill={colors.accent}
                                        />
                                    )}

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
                </div>

                <p className="mt-3 min-h-9 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                    {hovered ? (
                        <span>{describeSlot(hovered)}</span>
                    ) : (
                        <>
                            <MousePointerClick className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
                            <span className="text-slate-500 dark:text-slate-400">
                                Arahkan kursor ke port untuk detail. Klik port terisi untuk mengubah konfigurasi, klik slot kosong untuk provisioning.
                            </span>
                        </>
                    )}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 dark:border-slate-700 pt-3 text-[11px] text-slate-600 dark:text-slate-300">
                    {[
                        { label: "Active", color: FACEPLATE_PALETTE.active.fill },
                        { label: "Inactive", color: FACEPLATE_PALETTE.inactive.fill },
                        { label: "Down", color: FACEPLATE_PALETTE.down.fill },
                        { label: "Belum didokumentasikan", color: FACEPLATE_PALETTE.empty.fill },
                    ].map((item) => (
                        <span key={item.label} className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: item.color }} />
                            {item.label}
                        </span>
                    ))}
                    {[
                        { label: "Trunk", color: "#a855f7" },
                        { label: "Routed", color: "#f97316" },
                        { label: "LACP", color: "#38bdf8" },
                    ].map((item) => (
                        <span key={item.label} className="flex items-center gap-1.5">
                            <span className="w-1 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                            {item.label}
                        </span>
                    ))}
                    <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-slate-100 ring-1 ring-slate-400" />
                        Terhubung ke port lain
                    </span>
                </div>
            </div>

            {faceplate.unplaced.length > 0 && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 p-4">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        {faceplate.unplaced.length} port belum terpetakan ke slot fisik
                    </p>
                    <p className="mt-1 text-xs text-amber-800 dark:text-amber-300/80">
                        Nomor slot tidak bisa disimpulkan dari nama interface, di luar jangkauan layout, atau bentrok dengan port lain. Tentukan slotnya di bawah.
                    </p>
                    <ul className="mt-3 divide-y divide-amber-200 dark:divide-amber-900/40">
                        {faceplate.unplaced.map((port) => (
                            <UnplacedPortRow key={port.id} port={port} maxSlot={totalSlots} />
                        ))}
                    </ul>
                </div>
            )}

            {editingPort && (
                <EditPortModal
                    port={editingPort}
                    vlans={vlans}
                    otherDevices={otherDevices}
                    deviceId={deviceId}
                    onClose={() => setEditingPort(null)}
                />
            )}

            {addingSlot && (
                <QuickAddPortModal
                    deviceId={deviceId}
                    slotNumber={addingSlot.slotNumber}
                    slotLabel={addingSlot.block === "uplink" ? `Uplink Slot ${addingSlot.slotNumber}` : `Slot ${addingSlot.slotNumber}`}
                    suggestedName={suggestPortName(existingNames, addingSlot.slotNumber) ?? ""}
                    isUplinkSlot={addingSlot.block === "uplink"}
                    vlans={vlans}
                    onClose={() => setAddingSlot(null)}
                />
            )}
        </div>
    );
}
