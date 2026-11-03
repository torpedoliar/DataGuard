"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Search, X, Filter, Mail, MailCheck, MailX, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import {
    DataTable,
    DataTableBody,
    DataTableFrame,
    DataTableHead,
} from "@/components/ui/data-table";
import EmptyState from "@/components/ui/empty-state";
import StatusBadge from "@/components/ui/status-badge";
import type { UiTone } from "@/lib/ui/status";

type EmailAlertLog = {
    id: number;
    recipient: string;
    recipientName: string | null;
    incidentId?: number | null;
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

const STATUS_META: Record<string, { label: string; tone: UiTone; icon: React.ReactNode }> = {
    sent: { label: "Sent", tone: "success", icon: <MailCheck aria-hidden="true" className="size-3" /> },
    failed: { label: "Failed", tone: "danger", icon: <MailX aria-hidden="true" className="size-3" /> },
    pending: { label: "Pending", tone: "warning", icon: <Mail aria-hidden="true" className="size-3" /> },
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
        <div className="space-y-4">
            {/* Filters */}
            <div className="ops-panel flex flex-col gap-3 p-4 sm:flex-row">
                <form onSubmit={handleSearch} className="flex flex-1 gap-2">
                    <div className="relative flex-1">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Cari email penerima, subject, nama device, atau #incident..."
                            aria-label="Cari email log"
                            className="ops-input h-9 w-full pl-9 pr-8 text-sm"
                        />
                        {searchInput && (
                            <button type="button" onClick={() => { setSearchInput(""); navigate({ status: statusFilter }); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted transition-colors hover:text-ops-text" aria-label="Clear search">
                                <X aria-hidden="true" className="size-3.5" />
                            </button>
                        )}
                    </div>
                    <ActionButton type="submit" icon={<Search aria-hidden="true" className="size-4" />}>
                        Cari
                    </ActionButton>
                </form>

                <div className="flex gap-2">
                    <div className="relative">
                        <Filter aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ops-muted" />
                        <select
                            value={statusFilter}
                            onChange={e => navigate({ search, status: e.target.value, page: "1" })}
                            aria-label="Filter status"
                            className="ops-input h-9 cursor-pointer appearance-none pl-8 pr-3 text-sm"
                        >
                            <option value="">Semua Status</option>
                            <option value="sent">Sent</option>
                            <option value="failed">Failed</option>
                        </select>
                    </div>

                    {(search || statusFilter) && (
                        <ActionButton type="button" variant="danger" onClick={() => { setSearchInput(""); navigate({}); }} icon={<X aria-hidden="true" className="size-4" />}>
                            Reset
                        </ActionButton>
                    )}
                </div>
            </div>

            {/* Table */}
            {logs.length === 0 ? (
                <EmptyState
                    icon={<Mail aria-hidden="true" />}
                    title="Belum ada email PIC yang terkirim"
                    description="Email terkirim otomatis saat audit menemukan device NOT OK milik PIC group atau saat progress incident di-update."
                />
            ) : (
                <DataTableFrame>
                    <DataTable>
                        <DataTableHead>
                            <tr>
                                <th className="px-4 py-3 text-left">Waktu</th>
                                <th className="px-4 py-3 text-left">Incident</th>
                                <th className="px-4 py-3 text-left">Penerima</th>
                                <th className="px-4 py-3 text-left">Subject</th>
                                <th className="px-4 py-3 text-left">Devices</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-left">Error</th>
                            </tr>
                        </DataTableHead>
                        <DataTableBody>
                            {logs.map((log) => {
                                const status = STATUS_META[log.status] ?? STATUS_META.pending;
                                const detectedIncidentId = log.incidentId ?? (() => {
                                    const match = /#(\d+)/.exec(log.subject);
                                    return match ? parseInt(match[1], 10) : null;
                                })();

                                return (
                                    <tr key={log.id} className="align-top">
                                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-ops-muted">
                                            <div className="flex items-center gap-1.5">
                                                <Clock aria-hidden="true" className="size-3 shrink-0" />
                                                {formatDate(log.sentAt ?? log.createdAt)}
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            {detectedIncidentId ? (
                                                <Link
                                                    href={`/admin/incidents/${detectedIncidentId}`}
                                                    className="inline-flex items-center gap-1 rounded-sm border border-ops-info/30 bg-ops-info-soft px-2 py-0.5 text-xs font-medium tabular-nums text-ops-info transition-colors hover:border-ops-info/45"
                                                    title={`Lihat Detail Incident #${detectedIncidentId}`}
                                                >
                                                    <span>#{detectedIncidentId}</span>
                                                </Link>
                                            ) : (
                                                <span className="text-xs text-ops-muted">-</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            <p className="text-xs font-medium text-ops-text">{log.recipient}</p>
                                            {log.recipientName && <p className="text-[11px] text-ops-muted">{log.recipientName}</p>}
                                        </td>
                                        <td className="max-w-[260px] px-4 py-3">
                                            <p className="truncate text-xs text-ops-text" title={log.subject}>{log.subject}</p>
                                        </td>
                                        <td className="max-w-[280px] px-4 py-3">
                                            <span className="inline-flex items-center rounded-sm bg-ops-accent/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-ops-accent">
                                                {log.deviceCount} device{log.deviceCount === 1 ? "" : "s"}
                                            </span>
                                            {log.deviceSummary && (
                                                <p className="mt-1 line-clamp-2 text-[11px] text-ops-muted" title={log.deviceSummary}>{log.deviceSummary}</p>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            <StatusBadge tone={status.tone}>
                                                {status.icon}
                                                {status.label}
                                            </StatusBadge>
                                        </td>
                                        <td className="max-w-[180px] px-4 py-3">
                                            <p className="truncate text-xs text-ops-danger/80" title={log.error ?? ""}>{log.error ?? "-"}</p>
                                        </td>
                                    </tr>
                                );
                            })}
                        </DataTableBody>
                    </DataTable>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-ops-border px-4 py-3">
                            <p className="text-xs tabular-nums text-ops-muted">
                                Menampilkan {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} dari {total.toLocaleString()} email
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    disabled={page <= 1}
                                    onClick={() => navigate({ search, status: statusFilter, page: String(page - 1) })}
                                    className="rounded-md p-1.5 text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:pointer-events-none disabled:opacity-30"
                                    aria-label="Previous page"
                                >
                                    <ChevronLeft aria-hidden="true" className="size-4" />
                                </button>
                                <span className="px-2 text-xs tabular-nums text-ops-muted">{page} / {totalPages}</span>
                                <button
                                    type="button"
                                    disabled={page >= totalPages}
                                    onClick={() => navigate({ search, status: statusFilter, page: String(page + 1) })}
                                    className="rounded-md p-1.5 text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:pointer-events-none disabled:opacity-30"
                                    aria-label="Next page"
                                >
                                    <ChevronRight aria-hidden="true" className="size-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </DataTableFrame>
            )}
        </div>
    );
}
