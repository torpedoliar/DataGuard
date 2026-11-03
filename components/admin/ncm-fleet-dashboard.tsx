import Link from "next/link";
import StatusBadge from "@/components/ui/status-badge";
import EmptyState from "@/components/ui/empty-state";
import { DataTableEmpty } from "@/components/ui/data-table";
import type { FleetDriftRow, FleetSite, FleetSnapshot } from "@/lib/ncm-fleet";

// ==================== NCM fleet dashboard client (ticket 10) ====================
// Presentational only: the server page hands over one FleetSnapshot (badges +
// cross-site drift table) and this renders it. Reuses StatusBadge / card
// classes from ncm-dashboard.tsx; no data fetching here — an unreachable NCM
// already degraded server-side to reachable=false + error.

function formatLastSeen(value: Date | string | null): string {
    if (!value) return "tidak pernah";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? "tidak pernah" : date.toLocaleString();
}

function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function SiteCard({ site }: { site: FleetSite }) {
    if (!site.configured) {
        return (
            <div className="ops-panel p-4">
                <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{site.siteName}</p>
                <div className="mt-2">
                    <StatusBadge tone="neutral">belum dikonfigurasi</StatusBadge>
                </div>
            </div>
        );
    }
    return (
        <div className="ops-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{site.siteName}</p>
                {site.reachable ? (
                    <StatusBadge tone={site.status === "offline" ? "danger" : "success"} dot>
                        {site.status === "offline" ? "offline" : "online"}
                    </StatusBadge>
                ) : (
                    <StatusBadge tone="danger">tidak terjangkau</StatusBadge>
                )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ops-muted">
                <StatusBadge tone={site.openDriftCount > 0 ? "warning" : "neutral"}>
                    {site.openDriftCount} drift terbuka
                </StatusBadge>
                <span>terakhir terlihat {formatLastSeen(site.lastSeenAt)}</span>
            </div>
            {site.error && <p className="mt-2 truncate text-xs text-ops-danger" title={site.error}>{site.error.slice(0, 160)}</p>}
        </div>
    );
}

function DriftTable({ drifts }: { drifts: FleetDriftRow[] }) {
    return (
        <div className="overflow-x-auto rounded-lg border border-ops-border">
            <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] border-b border-ops-border bg-ops-surface-raised text-xs font-medium text-ops-muted">
                    <tr className="text-left">
                        <th className="py-2 pr-3 pl-3">Site</th>
                        <th className="py-2 pr-3">Review</th>
                        <th className="py-2 pr-3">Switch</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Dibuat</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-ops-border bg-ops-surface [&>tr:hover]:bg-ops-surface-raised/60">
                    {drifts.length === 0 && (
                        <DataTableEmpty colSpan={5} title="Tidak ada review drift terbuka lintas site." />
                    )}
                    {drifts.map((drift) => (
                        <tr key={`${drift.siteId}-${drift.reviewId}`}>
                            <td className="py-2 pr-3 pl-3 font-medium text-ops-text">{drift.siteName}</td>
                            <td className="py-2 pr-3">
                                <Link href="/admin/ncm" className="font-mono text-xs tabular-nums text-ops-accent hover:underline">
                                    #{drift.reviewId || "?"}
                                </Link>
                            </td>
                            <td className="py-2 pr-3 text-ops-muted">{drift.switchLabel || "-"}</td>
                            <td className="py-2 pr-3">
                                <StatusBadge tone="warning">{drift.status}</StatusBadge>
                            </td>
                            <td className="py-2 pr-3 tabular-nums text-ops-muted">{formatDate(drift.createdAt)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function NcmFleetDashboard({ snapshot }: { snapshot: FleetSnapshot }) {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ops-muted">
                <StatusBadge tone={snapshot.offlineCount > 0 ? "danger" : "success"} dot>
                    {snapshot.offlineCount} site offline
                </StatusBadge>
                <StatusBadge tone={snapshot.openDriftTotal > 0 ? "warning" : "neutral"}>
                    {snapshot.openDriftTotal} drift terbuka
                </StatusBadge>
                <span>diperbarui {formatDate(snapshot.checkedAt)}</span>
            </div>

            <section className="flex flex-col gap-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    Site <span className="tabular-nums text-ops-muted">({snapshot.sites.length})</span>
                </h2>
                {snapshot.sites.length === 0 ? (
                    <EmptyState title="Belum ada site aktif." />
                ) : (
                    <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {snapshot.sites.map((site) => (
                            <SiteCard key={site.siteId} site={site} />
                        ))}
                    </div>
                )}
            </section>

            <section className="ops-panel flex flex-col gap-3 p-4">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    Drift terbuka lintas site <span className="tabular-nums text-ops-muted">({snapshot.drifts.length})</span>
                </h2>
                <DriftTable drifts={snapshot.drifts} />
                <p className="text-[13px] text-ops-muted">
                    Detail + keputusan review tetap di <Link href="/admin/ncm" className="text-ops-accent hover:underline">halaman NCM site aktif</Link> —
                    ganti site via pemilih site bila review milik site lain.
                </p>
            </section>
        </div>
    );
}
