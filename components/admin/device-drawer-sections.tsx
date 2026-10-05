"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ClipboardCheck, Network, ShieldAlert, Siren } from "lucide-react";
import { getDeviceDrawer, type DeviceDrawer } from "@/actions/device-drawer";
import { SEVERITY_COLOR, type Severity } from "@/lib/rack-signals";

// Drawer data for one device, re-fetched when the device changes; a stale
// response for the previous device is ignored.
export function useDeviceDrawer(deviceId: number | null, supplied?: { loading: boolean; data: DeviceDrawer | null; error?: boolean }) {
    const [loaded, setLoaded] = useState<{ id: number; data: DeviceDrawer | null; error: boolean } | null>(null);

    useEffect(() => {
        if (deviceId == null || supplied !== undefined) return;
        let alive = true;
        getDeviceDrawer(deviceId)
            .then((data) => { if (alive) setLoaded({ id: deviceId, data, error: data === null }); })
            .catch(() => { if (alive) setLoaded({ id: deviceId, data: null, error: true }); });
        return () => { alive = false; };
    }, [deviceId, supplied]);

    const ready = deviceId != null && loaded?.id === deviceId;
    if (supplied !== undefined) return { ...supplied, error: supplied.error ?? false };
    return { loading: deviceId != null && !ready, data: ready ? loaded.data : null, error: ready ? loaded.error : false };
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section className="mt-5 border-t border-ops-border pt-4" aria-label={title}>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ops-text">{icon} {title}</h4>
            {children}
        </section>
    );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-xs text-ops-muted">{children}</p>;

export function SeverityChip({ severity }: { severity: Severity }) {
    return (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: SEVERITY_COLOR[severity] }}>
            {severity}
        </span>
    );
}

export function AuditSection({ drawer, onPhoto }: { drawer: DeviceDrawer; onPhoto: (path: string) => void }) {
    const a = drawer.lastAudit;
    return (
        <Section icon={<ClipboardCheck className="h-4 w-4 text-ops-accent" />} title="Last audit">
            {!a ? <Empty>Never audited.</Empty> : (
                <div className="space-y-2 text-sm">
                    <p className="text-ops-text">
                        {a.checkDate} · {a.shift} ·{" "}
                        <span className={a.status === "NOT OK" ? "font-semibold text-ops-danger" : "font-semibold text-ops-success"}>{a.status}</span>
                    </p>
                    {a.remarks && <p className="text-xs text-ops-muted">{a.remarks}</p>}
                    {a.photoPath && (
                        <button type="button" onClick={() => onPhoto(a.photoPath!)} aria-label="Enlarge finding photo" className="block cursor-zoom-in">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.photoPath} alt="Audit finding" className="h-20 w-28 rounded border border-ops-border object-cover" />
                        </button>
                    )}
                </div>
            )}
        </Section>
    );
}

export function IncidentsSection({ drawer }: { drawer: DeviceDrawer }) {
    return (
        <Section icon={<Siren className="h-4 w-4 text-ops-danger" />} title="Open incidents">
            {drawer.incidents.length === 0 ? <Empty>No open incidents.</Empty> : (
                <ul className="space-y-1.5">
                    {drawer.incidents.map((i) => (
                        <li key={i.id}>
                            <Link href={`/admin/incidents/${i.id}`} className="flex items-center gap-2 text-sm text-ops-text hover:underline">
                                <SeverityChip severity={i.severity} />
                                <span className="truncate">{i.title}</span>
                                <span className="ml-auto shrink-0 text-[10px] text-ops-muted">{i.status}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

export function SiemSection({ drawer }: { drawer: DeviceDrawer }) {
    return (
        <Section icon={<ShieldAlert className="h-4 w-4 text-ops-warning" />} title="SIEM findings">
            {drawer.siem.count === 0 ? <Empty>No open SIEM findings.</Empty> : (
                <>
                    <ul className="space-y-1.5">
                        {drawer.siem.latest.map((f) => (
                            <li key={f.id} className="flex items-center gap-2 text-sm text-ops-text">
                                <SeverityChip severity={f.severity} />
                                <span className="truncate">{f.title}</span>
                            </li>
                        ))}
                    </ul>
                    <Link href="/admin/siem/findings" className="mt-2 flex items-center gap-1 text-xs font-medium text-ops-accent hover:underline">
                        {drawer.siem.count} open finding{drawer.siem.count > 1 ? "s" : ""} <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                </>
            )}
        </Section>
    );
}

// Clicking a connection selects the peer (3D flies to it); when the caller
// does not know the peer (other room / unracked) its network docs open.
export function ConnectionsSection({ drawer, onSelectPeer }: { drawer: DeviceDrawer; onSelectPeer?: (deviceId: number) => boolean }) {
    const router = useRouter();
    const open = (id: number) => {
        if (!onSelectPeer?.(id)) router.push(`/admin/devices/${id}/network`);
    };
    return (
        <Section icon={<Network className="h-4 w-4 text-ops-accent" />} title="Connections">
            {drawer.connections.length === 0 ? <Empty>No documented cabling.</Empty> : (
                <ul className="space-y-1">
                    {drawer.connections.map((c) => (
                        <li key={`${c.portName}-${c.peerDeviceId}`}>
                            <button
                                type="button"
                                onClick={() => open(c.peerDeviceId)}
                                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-ops-text hover:bg-ops-bg"
                            >
                                <span className="w-20 shrink-0 font-mono text-ops-muted">{c.portName}</span>
                                <span className="truncate font-medium">{c.peerDeviceName}</span>
                                <span className="truncate font-mono text-ops-muted">{c.peerPortName ?? ""}</span>
                                <span className="ml-auto shrink-0 text-[10px] text-ops-muted">
                                    {c.portMode ?? ""}{c.vlan != null ? ` · VLAN ${c.vlan}` : ""}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
