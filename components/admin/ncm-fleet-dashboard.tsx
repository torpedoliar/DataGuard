import Link from "next/link";
import StatusBadge from "@/components/ui/status-badge";
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
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
                <p className="truncate text-sm font-semibold text-white">{site.siteName}</p>
                <div className="mt-2">
                    <StatusBadge tone="neutral">belum dikonfigurasi</StatusBadge>
                </div>
            </div>
        );
    }
    return (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-white">{site.siteName}</p>
                {site.reachable ? (
                    <StatusBadge tone={site.status === "offline" ? "danger" : "success"} dot>
                        {site.status === "offline" ? "offline" : "online"}
                    </StatusBadge>
                ) : (
                    <StatusBadge tone="danger">tidak terjangkau</StatusBadge>
                )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ops-muted">
                <StatusBadge tone={site.openDriftCount > 0 ? "warning" : "neutral"}>
                    {site.openDriftCount} drift terbuka
                </StatusBadge>
                <span>terakhir terlihat {formatLastSeen(site.lastSeenAt)}</span>
            </div>
            {site.error && <p className="mt-2 truncate text-xs text-red-300" title={site.error}>{site.error.slice(0, 160)}</p>}
        </div>
    );
}

function DriftTable({ drifts }: { drifts: FleetDriftRow[] }) {
    if (drifts.length === 0) {
        return <p className="text-sm text-ops-muted">Tidak ada review drift terbuka lintas site.</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
                        <th className="py-2 pr-3">Site</th>
                        <th className="py-2 pr-3">Review</th>
                        <th className="py-2 pr-3">Switch</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Dibuat</th>
                    </tr>
                </thead>
                <tbody>
                    {drifts.map((drift) => (
                        <tr key={`${drift.siteId}-${drift.reviewId}`} className="border-t border-slate-800">
                            <td className="py-2 pr-3 font-medium text-white">{drift.siteName}</td>
                            <td className="py-2 pr-3">
                                <Link href="/admin/ncm" className="font-mono text-xs text-ops-accent hover:underline">
                                    #{drift.reviewId || "?"}
                                </Link>
                            </td>
                            <td className="py-2 pr-3 text-slate-300">{drift.switchLabel || "-"}</td>
                            <td className="py-2 pr-3">
                                <StatusBadge tone="warning">{drift.status}</StatusBadge>
                            </td>
                            <td className="py-2 pr-3 text-slate-300">{formatDate(drift.createdAt)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function NcmFleetDashboard({ snapshot }: { snapshot: FleetSnapshot }) {
    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ops-muted">
                <StatusBadge tone={snapshot.offlineCount > 0 ? "danger" : "success"} dot>
                    {snapshot.offlineCount} site offline
                </StatusBadge>
                <StatusBadge tone={snapshot.openDriftTotal > 0 ? "warning" : "neutral"}>
                    {snapshot.openDriftTotal} drift terbuka
                </StatusBadge>
                <span>diperbarui {formatDate(snapshot.checkedAt)}</span>
            </div>

            <section className="space-y-3">
                <h2 className="text-sm font-semibold text-white">Site ({snapshot.sites.length})</h2>
                {snapshot.sites.length === 0 ? (
                    <p className="text-sm text-ops-muted">Belum ada site aktif.</p>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {snapshot.sites.map((site) => (
                            <SiteCard key={site.siteId} site={site} />
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
                <h2 className="text-sm font-semibold text-white">Drift terbuka lintas site ({snapshot.drifts.length})</h2>
                <DriftTable drifts={snapshot.drifts} />
                <p className="text-xs text-ops-muted">
                    Detail + keputusan review tetap di <Link href="/admin/ncm" className="text-ops-accent hover:underline">halaman NCM site aktif</Link> —
                    ganti site via pemilih site bila review milik site lain.
                </p>
            </section>
        </div>
    );
}
