"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Cable, Loader2 } from "lucide-react";
import { getPortsByDevice } from "@/actions/network";
import type { RackDevice } from "@/actions/rack-layout";
import { buildFaceplate, comparePortNames, faceplateSlotColors, FACEPLATE_PALETTE } from "@/lib/faceplate";

type Port = Awaited<ReturnType<typeof getPortsByDevice>>[number];

export function portMatchesVlan(port: Port, query: string): boolean {
    if (!query.trim()) return true;
    if (!/^\d+$/.test(query.trim())) return false;
    const number = Number(query);
    if (number < 1 || number > 4094) return false;
    if (port.vlanNumber === number) return true;
    if (port.portMode !== "Trunk") return false;
    return (port.trunkVlans ?? "").split(/[,;\s]+/).some((token) => {
        if (/^all$/i.test(token)) return true;
        if (/^\d+$/.test(token)) return Number(token) === number;
        const range = token.match(/^(\d+)-(\d+)$/);
        return !!range && number >= Number(range[1]) && number <= Number(range[2]);
    });
}

function vlanLabel(port: Port): string {
    const assigned = port.vlanNumber != null ? `${port.vlanNumber}${port.vlanName ? ` · ${port.vlanName}` : ""}` : "Belum didokumentasikan";
    if (port.portMode === "Trunk") return `Allowed VLANs: ${port.trunkVlans?.trim() || "Belum didokumentasikan"}`;
    return `${port.portMode === "Access" ? "Access VLAN" : "VLAN"}: ${assigned}`;
}

function peerLabel(port: Port): string {
    return port.connectedToDeviceName
        ? `${port.connectedToDeviceName}${port.connectedToPortName ? ` · ${port.connectedToPortName}` : ""}`
        : port.connectedToPortName || "Belum didokumentasikan";
}

export default function DeviceNetworkSummary({ device, supplied, expanded = false }: { device: RackDevice; expanded?: boolean; supplied?: { ports: Port[]; loading: boolean; error?: boolean } }) {
    const [loaded, setLoaded] = useState<{ id: number; ports: Port[]; error: boolean } | null>(null);
    const [vlan, setVlan] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [hovered, setHovered] = useState<string | null>(null);
    const filterId = useId();

    useEffect(() => {
        if (supplied !== undefined) return;
        let alive = true;
        getPortsByDevice(device.id).then((ports) => { if (alive) setLoaded({ id: device.id, ports, error: false }); }).catch(() => {
            if (alive) setLoaded({ id: device.id, ports: [], error: true });
        });
        return () => { alive = false; };
    }, [device.id, supplied]);

    const ports = supplied ? (supplied.loading ? null : supplied.ports) : loaded?.id === device.id ? loaded.ports : null;
    const plate = useMemo(() => (ports && (device.faceplatePortCount ?? 0) > 0 ? buildFaceplate({ portCount: device.faceplatePortCount, uplinkCount: device.faceplateUplinkCount, rows: device.faceplateRows, numbering: device.faceplateNumbering }, ports) : null), [device, ports]);
    const ordered = [...(ports ?? [])].sort((a, b) => comparePortNames(a.portName, b.portName));
    const visible = ordered.filter((port) => portMatchesVlan(port, vlan));
    const keyForPort = (port: Port) => `port-${port.id}`;
    const slotKey = (slot: NonNullable<typeof plate>["slots"][number]) => slot.port ? keyForPort(slot.port) : slot.key;
    const activeKey = hovered ?? selected;
    const activeSlot = plate?.slots.find((slot) => slotKey(slot) === activeKey);
    const activePort = ordered.find((port) => keyForPort(port) === activeKey);
    const count = (pred: (p: Port) => boolean) => ports?.filter(pred).length ?? 0;
    const stats: [string, number][] = [["Ports", ports?.length ?? 0], ["Active", count((p) => p.status === "Active")], ["Access", count((p) => p.portMode === "Access")], ["Trunk", count((p) => p.portMode === "Trunk")]];

    return (
        <section className="mt-6 min-w-0 border-t border-ops-border pt-4" aria-label="Network docs">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-ops-text"><Cable className="h-4 w-4 text-ops-accent" /> Network docs</h4>
                <Link href={`/admin/devices/${device.id}/network`} className="flex items-center gap-1 text-xs font-medium text-ops-accent hover:underline">Open network docs <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>
            {(supplied?.error || (loaded?.id === device.id && loaded.error)) ? <p role="alert" className="text-xs text-ops-danger">Unable to load network ports.</p> : ports === null ? (
                <p className="flex items-center gap-2 text-xs text-ops-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading ports…</p>
            ) : ports.length === 0 && !plate ? (
                <p className="text-xs text-ops-muted">No network ports documented for this device.</p>
            ) : (
                <>
                    <dl className="grid grid-cols-4 gap-2">{stats.map(([label, value]) => <div key={label} className="rounded-lg border border-ops-border bg-ops-bg px-2 py-1.5 text-center"><dt className="text-[10px] uppercase tracking-wider text-ops-muted">{label}</dt><dd className="text-base font-bold tabular-nums text-ops-text">{value}</dd></div>)}</dl>
                    {plate && <>
                        <div className="mt-3 overflow-x-auto rounded border border-ops-border">
                            <svg viewBox={`0 0 ${plate.width} ${plate.height}`} className="h-auto w-full" style={{ minWidth: plate.width * 2 }} role="group" aria-label={`${device.name} faceplate: ${stats[1][1]} active of ${plate.slots.length} ports`}>
                                <rect width={plate.width} height={plate.height} rx={3} fill={FACEPLATE_PALETTE.chassis.fill} stroke={FACEPLATE_PALETTE.chassis.stroke} strokeWidth={0.8} />
                                {plate.blocks.map((block) => <text key={block.block} x={block.x} y={block.labelY} fontSize={6} fill={FACEPLATE_PALETTE.empty.label}>{block.label}</text>)}
                                {plate.slots.map((slot) => {
                                    const colors = faceplateSlotColors(slot.port);
                                    const key = slotKey(slot);
                                    const label = `Slot ${slot.slotNumber} · ${slot.port ? `${slot.port.portName} · ${slot.port.status ?? "Unknown"} · ${slot.port.portMode ?? "Mode belum diisi"} · ${vlanLabel(slot.port)} · Tujuan: ${peerLabel(slot.port)}` : "Belum didokumentasikan"}`;
                                    const matches = !vlan || !!slot.port && portMatchesVlan(slot.port, vlan);
                                    return <g key={slot.key} role="button" tabIndex={0} aria-label={label} aria-pressed={selected === key} className="cursor-pointer outline-none" opacity={matches ? 1 : 0.3} onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(key)} onBlur={() => setHovered(null)} onClick={() => setSelected(key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(key); } if (event.key === "Escape") { setSelected(null); setHovered(null); } }}>
                                        <title>{label}</title>
                                        <rect x={slot.x} y={slot.y} width={slot.width} height={slot.height} rx={1.5} fill={colors.fill} stroke={activeKey === key ? "#f8fafc" : colors.stroke} strokeWidth={activeKey === key ? 1.5 : 0.7} strokeDasharray={slot.port ? undefined : "2 1.5"} />
                                        {colors.accent && <rect x={slot.x} y={slot.y} width={2} height={slot.height} fill={colors.accent} />}
                                        <text x={slot.x + slot.width / 2} y={slot.y + slot.height / 2 + 2.5} textAnchor="middle" fontSize={7} fontWeight={600} fill={colors.label} pointerEvents="none">{slot.slotNumber}</text>
                                    </g>;
                                })}
                            </svg>
                        </div>
                        <p className="mt-2 text-xs text-ops-muted">Active · hijau / Inactive · abu-abu / Down · merah / Kosong · putus-putus</p>
                    </>}
                    {(plate || expanded) && <div className="mt-3 min-h-24 border-y border-ops-border py-3 text-xs" aria-live="polite">
                        {activePort ? <>
                            <div className="flex items-center justify-between gap-2"><strong className="break-all text-sm text-ops-text">{activeSlot ? `Slot ${activeSlot.slotNumber} · ` : ""}{activePort.portName}</strong>{selected && <button type="button" onClick={() => { setSelected(null); setHovered(null); }} className="shrink-0 text-ops-accent hover:underline">Lepas pilihan</button>}</div>
                            <p className="mt-1 text-ops-muted">{[activePort.status ?? "Status belum diisi", activePort.portMode, activePort.speed, activePort.mediaType].filter(Boolean).join(" · ")}</p>
                            {activePort.portMode === "Trunk" && <p className="mt-2">Native VLAN: {activePort.vlanNumber != null ? `${activePort.vlanNumber}${activePort.vlanName ? ` · ${activePort.vlanName}` : ""}` : "Belum didokumentasikan"}</p>}
                            {activePort.portMode === "Trunk" && (activePort.trunkVlans?.length ?? 0) > 80 ? <details key={activePort.id} className="mt-2"><summary className="cursor-pointer text-ops-accent">Allowed VLANs · lihat daftar lengkap</summary><p className="mt-2 break-words">{activePort.trunkVlans}</p></details> : <p className="mt-2 break-words">{vlanLabel(activePort)}</p>}
                            <p className="mt-2 break-words"><span className="text-ops-muted">Tujuan: </span>{peerLabel(activePort)}</p>
                            {activePort.ipAddress && <p className="mt-2">IP: {activePort.ipAddress}</p>}
                            {activePort.macAddress && <p className="mt-2">MAC: {activePort.macAddress}</p>}
                            {activePort.description && <p className="mt-2 break-words">{activePort.description}</p>}
                        </> : activeSlot ? <p>Slot {activeSlot.slotNumber} · Belum didokumentasikan. Buka network docs untuk provisioning.</p> : <p className="text-ops-muted">Arahkan atau fokuskan port untuk detail. Klik/tap port untuk mengunci detail; pilih baris port untuk menyorot slot yang sama.</p>}
                    </div>}
                    {expanded && <>
                        <div className="mt-4 flex items-center gap-2"><label htmlFor={filterId} className="shrink-0 text-xs font-medium">Filter VLAN</label><input id={filterId} type="text" inputMode="numeric" value={vlan} onChange={(event) => setVlan(event.target.value)} placeholder="Nomor VLAN" className="ops-input min-w-0 flex-1 px-2 py-2 text-xs" />{vlan && <button type="button" onClick={() => setVlan("")} className="text-xs text-ops-accent hover:underline">Reset</button>}</div>
                        <p className="mt-2 text-xs text-ops-muted">{visible.length} / {ports.length} port · Access/native dan allowed VLANs trunk</p>
                        {visible.length === 0 ? <p className="mt-3 text-xs text-ops-muted">Tidak ada port dengan VLAN ini dalam dokumentasi.</p> : <ul className="mt-2 max-h-80 overflow-y-auto divide-y divide-ops-border">{visible.map((port) => {
                            const slot = plate?.slots.find((item) => item.port?.id === port.id);
                            return <li key={port.id} data-port-row={port.id}><button type="button" aria-pressed={selected === keyForPort(port)} onClick={() => { setSelected(keyForPort(port)); setHovered(null); }} className={`w-full px-2 py-3 text-left text-xs hover:bg-ops-surface-raised focus-visible:outline-2 focus-visible:outline-ops-accent ${selected === keyForPort(port) ? "bg-ops-accent/10" : ""}`}>
                                <span className="flex flex-wrap items-baseline justify-between gap-1"><strong className="break-all font-mono text-ops-text">{port.portName}</strong><span className="text-ops-muted">{port.status ?? "Unknown"} · {port.portMode ?? "Mode belum diisi"}</span></span>
                                <span className="mt-1 block text-ops-muted">{slot ? `Slot ${slot.slotNumber}` : "Belum terpetakan ke slot fisik"}</span>
                                <span className="mt-2 line-clamp-2 break-words">{port.portMode === "Trunk" && port.vlanNumber != null ? `Native VLAN: ${port.vlanNumber} · ` : ""}{vlanLabel(port)}</span>
                                <span className="mt-1 block break-words text-ops-muted">Tujuan: {peerLabel(port)}</span>
                            </button></li>;
                        })}</ul>}
                    </>}
                </>
            )}
        </section>
    );
}
