"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, X, Filter, Mail, MailCheck, MailX, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

type EmailAlertLog = {
    id: number;
    recipient: string;
    recipientName: string | null;
    subject: string;
    deviceCount: number;
    deviceSummary: string | null;
    status: string;
    error: string | null;
    sentAt: Date | null;
    createdAt: Date | null;
};

function formatDate(date: Date | null) {
    if (!date) return "-";
    return new Date(date).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    });
}

const STATUS_META: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    sent: { label: "Sent", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <MailCheck className="h-3 w-3" /> },
    failed: { label: "Failed", className: "bg-red-500/15 text-red-400 border-red-500/30", icon: <MailX className="h-3 w-3" /> },
    pending: { label: "Pending", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: <Mail className="h-3 w-3" /> },
};

export default function EmailLogClient({
    logs,
    total,
    page,
    totalPages,
    search,
    statusFilter,
}: {
    logs: EmailAlertLog[];
    total: number;
    page: number;
    totalPages: number;
    search: string;
    statusFilter: string;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [searchInput, setSearchInput] = useState(search);

    const navigate = useCallback((params: Record<string, string>) => {
        const sp = new URLSearchParams();
        if (params.search) sp.set("search", params.search);
        if (params.status) sp.set("status", params.status);
        if (params.page && params.page !== "1") sp.set("page", params.page);
        router.push(`${pathname}?${sp.toString()}`);
    }, [router, pathname]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        navigate({ search: searchInput, status: statusFilter, page: "1" });
    };

    return (
        <div className="space-y-5">
            {/* Filters */}
            <div className="ops-panel p-4 flex flex-col sm:flex-row gap-3">
                <form onSubmit={handleSearch} className="flex flex-1 gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ops-muted" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Cari email penerima, subject, atau nama device..."
                            className="ops-input w-full h-9 pl-9 pr-8 text-sm"
                        />
                        {searchInput && (
                            <button type="button" onClick={() => { setSearchInput(""); navigate({ status: statusFilter }); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" aria-label="Clear search">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <button type="submit" className="h-9 px-4 rounded-md bg-ops-accent text-slate-950 text-sm font-semibold hover:bg-[#0a7a6f] flex items-center gap-1.5">
                        <Search className="h-3.5 w-3.5" /> Cari
                    </button>
                </form>

                <div className="flex gap-2">
                    <div className="relative">
                        <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ops-muted pointer-events-none" />
                        <select
                            value={statusFilter}
                            onChange={e => navigate({ search, status: e.target.value, page: "1" })}
                            className="ops-input h-9 pl-8 pr-3 text-sm appearance-none cursor-pointer"
                        >
                            <option value="">Semua Status</option>
                            <option value="sent">Sent</option>
                            <option value="failed">Failed</option>
                        </select>
                    </div>

                    {(search || statusFilter) && (
                        <button onClick={() => { setSearchInput(""); navigate({}); }} className="h-9 px-3 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 text-sm hover:bg-red-500/20 flex items-center gap-1.5">
                            <X className="h-3.5 w-3.5" /> Reset
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="ops-panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-[11px] uppercase tracking-wider text-ops-muted border-b border-ops-border">
                            <tr>
                                <th className="px-4 py-3 text-left">Waktu</th>
                                <th className="px-4 py-3 text-left">Penerima</th>
                                <th className="px-4 py-3 text-left">Subject</th>
                                <th className="px-4 py-3 text-left">Devices</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-left">Error</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ops-border/40">
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-12 text-center text-ops-muted">
                                        <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                        <p>Belum ada email PIC yang terkirim</p>
                                        <p className="mt-1 text-xs">Email terkirim otomatis saat audit menemukan device NOT OK milik PIC group.</p>
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => {
                                    const status = STATUS_META[log.status] ?? STATUS_META.pending;
                                    return (
                                        <tr key={log.id} className="hover:bg-ops-surface/60 transition-colors align-top">
                                            <td className="px-4 py-3 whitespace-nowrap text-xs text-ops-muted">
                                                <div className="flex items-center gap-1.5">
                                                    <Clock className="h-3 w-3 shrink-0" />
                                                    {formatDate(log.sentAt ?? log.createdAt)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <p className="text-ops-text font-medium text-xs">{log.recipient}</p>
                                                {log.recipientName && <p className="text-ops-muted text-[10px]">{log.recipientName}</p>}
                                            </td>
                                            <td className="px-4 py-3 max-w-[260px]">
                                                <p className="text-ops-text text-xs truncate" title={log.subject}>{log.subject}</p>
                                            </td>
                                            <td className="px-4 py-3 max-w-[280px]">
                                                <span className="inline-flex items-center rounded-full bg-ops-accent/15 px-2 py-0.5 text-[10px] font-bold text-ops-accent">
                                                    {log.deviceCount} device{log.deviceCount === 1 ? "" : "s"}
                                                </span>
                                                {log.deviceSummary && (
                                                    <p className="mt-1 text-ops-muted text-[10px] line-clamp-2" title={log.deviceSummary}>{log.deviceSummary}</p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border", status.className)}>
                                                    {status.icon}
                                                    {status.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 max-w-[180px]">
                                                <p className="text-red-300/80 text-xs truncate" title={log.error ?? ""}>{log.error ?? "-"}</p>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-ops-border flex items-center justify-between">
                        <p className="text-xs text-ops-muted">
                            Menampilkan {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} dari {total.toLocaleString()} email
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                disabled={page <= 1}
                                onClick={() => navigate({ search, status: statusFilter, page: String(page - 1) })}
                                className="p-1.5 rounded-md hover:bg-ops-surface disabled:opacity-30 disabled:pointer-events-none"
                                aria-label="Previous page"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="px-2 text-xs text-ops-muted">{page} / {totalPages}</span>
                            <button
                                disabled={page >= totalPages}
                                onClick={() => navigate({ search, status: statusFilter, page: String(page + 1) })}
                                className="p-1.5 rounded-md hover:bg-ops-surface disabled:opacity-30 disabled:pointer-events-none"
                                aria-label="Next page"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
