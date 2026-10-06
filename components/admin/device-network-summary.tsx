"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Cable, Loader2 } from "lucide-react";
import { getPortsByDevice } from "@/actions/network";
import type { RackDevice } from "@/actions/rack-layout";
import { buildFaceplate, faceplateSlotColors, FACEPLATE_PALETTE } from "@/lib/faceplate";

type Port = Awaited<ReturnType<typeof getPortsByDevice>>[number];

// Network docs at a glance in the device drawer: port counts, a read-only
// faceplate and a link to the full network page (edit, VLANs, cabling).
export default function DeviceNetworkSummary({ device, supplied, expanded = false }: { device: RackDevice; expanded?: boolean; supplied?: { ports: Port[]; loading: boolean; error?: boolean } }) {
    const [loaded, setLoaded] = useState<{ id: number; ports: Port[]; error: boolean } | null>(null);

    useEffect(() => {
        if (supplied !== undefined) return;
        let alive = true;
        getPortsByDevice(device.id).then((ports) => { if (alive) setLoaded({ id: device.id, ports, error: false }); }).catch(() => {
            if (alive) setLoaded({ id: device.id, ports: [], error: true });
        });
        return () => { alive = false; };
    }, [device.id, supplied]);

    const ports = supplied ? (supplied.loading ? null : supplied.ports) : loaded?.id === device.id ? loaded.ports : null;
    const config = useMemo(() => ({
        portCount: device.faceplatePortCount,
        uplinkCount: device.faceplateUplinkCount,
        rows: device.faceplateRows,
        numbering: device.faceplateNumbering,
    }), [device]);
    const plate = useMemo(() => (ports && (device.faceplatePortCount ?? 0) > 0 ? buildFaceplate(config, ports) : null), [config, ports, device.faceplatePortCount]);

    const count = (pred: (p: Port) => boolean) => ports?.filter(pred).length ?? 0;
    const stats: [string, number][] = [
        ["Ports", ports?.length ?? 0],
        ["Active", count((p) => p.status === "Active")],
        ["Access", count((p) => p.portMode === "Access")],
        ["Trunk", count((p) => p.portMode === "Trunk")],
    ];

    return (
        <section className="mt-6 border-t border-ops-border pt-4" aria-label="Network docs">
            <div className="mb-3 flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-ops-text">
                    <Cable className="h-4 w-4 text-ops-accent" /> Network docs
                </h4>
                <Link
                    href={`/admin/devices/${device.id}/network`}
                    className="flex items-center gap-1 text-xs font-medium text-ops-accent hover:underline"
                >
                    Open network docs <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
            </div>

            {(supplied?.error || (loaded?.id === device.id && loaded.error)) ? <p role="alert" className="text-xs text-ops-danger">Unable to load network ports.</p> : ports === null ? (
                <p className="flex items-center gap-2 text-xs text-ops-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading ports…</p>
            ) : ports.length === 0 && !plate ? (
                <p className="text-xs text-ops-muted">No network ports documented for this device.</p>
            ) : (
                <>
                    <dl className="grid grid-cols-4 gap-2">
                        {stats.map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-ops-border bg-ops-bg px-2 py-1.5 text-center">
                                <dt className="text-[10px] uppercase tracking-wider text-ops-muted">{label}</dt>
                                <dd className="text-base font-bold text-ops-text">{value}</dd>
                            </div>
                        ))}
                    </dl>
                    {expanded && <div className="mt-3 flex flex-wrap gap-1">{Array.from(new Set(ports.flatMap((port) => [port.vlanNumber != null ? `VLAN ${port.vlanNumber}${port.vlanName ? ` · ${port.vlanName}` : ""}` : null, port.trunkVlans ? `Trunk ${port.trunkVlans}` : null]).filter((value): value is string => !!value))).map((label) => <span key={label} className="rounded border border-ops-border bg-ops-bg px-2 py-1 text-[10px]">{label}</span>)}</div>}
                    {plate && (
                        <svg
                            viewBox={`0 0 ${plate.width} ${plate.height}`}
                            className="mt-3 h-auto w-full"
                            role="img"
                            aria-label={`${device.name} faceplate: ${stats[1][1]} active of ${plate.slots.length} ports`}
                        >
                            <rect width={plate.width} height={plate.height} rx={3} fill={FACEPLATE_PALETTE.chassis.fill} stroke={FACEPLATE_PALETTE.chassis.stroke} strokeWidth={0.8} />
                            {plate.slots.map((slot) => {
                                const c = faceplateSlotColors(slot.port);
                                return (
                                    <rect
                                        key={slot.key}
                                        x={slot.x}
                                        y={slot.y}
                                        width={slot.width}
                                        height={slot.height}
                                        rx={1.5}
                                        fill={c.fill}
                                        stroke={c.stroke}
                                        strokeWidth={0.7}
                                        strokeDasharray={slot.port ? undefined : "2 1.5"}
                                    >
                                        <title>{slot.port ? `${slot.port.portName} · ${slot.port.status ?? "-"}` : `Slot ${slot.slotNumber} · empty`}</title>
                                    </rect>
                                );
                            })}
                        </svg>
                    )}
                    {expanded && <ul className="mt-3 max-h-64 overflow-y-auto space-y-1 text-xs">{ports.map((port) => <li key={port.id} className="flex flex-wrap gap-2 rounded border border-ops-border p-2"><strong className="font-mono">{port.portName}</strong><span>{port.status ?? "Unknown"}</span><span>{port.portMode}</span><span className="text-ops-muted">{port.connectedToDeviceName ?? "No documented peer"}{port.connectedToPortName ? ` · ${port.connectedToPortName}` : ""}</span></li>)}</ul>}
                </>
            )}
        </section>
    );
}
