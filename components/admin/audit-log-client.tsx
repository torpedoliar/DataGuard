"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, Shield, X, Filter, ChevronLeft, ChevronRight, Clock, User, Tag, Activity, Trash2, PenLine, Plus, LogIn, LogOut, RefreshCw, Upload } from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import { DataTable, DataTableBody, DataTableFrame, DataTableHead } from "@/components/ui/data-table";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";

type AuditLog = {
    id: number;
    userId: number | null;
    username: string | null;
    userRole: string | null;
    action: string;
    entity: string | null;
    entityId: number | null;
    entityName: string | null;
    detail: string | null;
    ipAddress: string | null;
    siteId: number | null;
    siteName: string | null;
    createdAt: Date | null;
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
    CREATE: <Plus aria-hidden="true" className="size-3.5" />,
    UPDATE: <PenLine aria-hidden="true" className="size-3.5" />,
    DELETE: <Trash2 aria-hidden="true" className="size-3.5" />,
    LOGIN: <LogIn aria-hidden="true" className="size-3.5" />,
    LOGOUT: <LogOut aria-hidden="true" className="size-3.5" />,
    TOGGLE: <RefreshCw aria-hidden="true" className="size-3.5" />,
    UPLOAD: <Upload aria-hidden="true" className="size-3.5" />,
};

const ACTION_COLORS: Record<string, string> = {
    CREATE: "bg-ops-success-soft text-ops-success border-ops-success/30",
    UPDATE: "bg-ops-info-soft text-ops-info border-ops-info/30",
    DELETE: "bg-ops-danger-soft text-ops-danger border-ops-danger/30",
    LOGIN: "bg-ops-info-soft text-ops-info border-ops-info/30",
    LOGOUT: "bg-ops-surface-sunken/15 text-ops-muted border-ops-border-strong/30",
    TOGGLE: "bg-ops-warning-soft text-ops-warning border-ops-warning/30",
    UPLOAD: "bg-ops-info-soft text-ops-info border-ops-info/30",
    SCHEMA_PUSH: "bg-ops-orange-soft text-ops-orange border-ops-orange/30",
    EXPORT: "bg-ops-info-soft text-ops-info border-ops-info/30",
};

const ENTITY_LABELS: Record<string, string> = {
    device: "Device",
    brand: "Brand",
    category: "Category",
    location: "Location",
    rack: "Rack",
    user: "User",
    vlan: "VLAN",
    network_port: "Port",
    checklist: "Checklist",
    settings: "Settings",
    site: "Site",
    session: "Session",
};

const ALL_ENTITIES = Object.keys(ENTITY_LABELS);
const ALL_ACTIONS = ["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "TOGGLE", "UPLOAD", "SCHEMA_PUSH", "EXPORT"];

function formatDate(date: Date | null) {
    if (!date) return "-";
    return new Date(date).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    });
}

export default function AuditLogClient({
    logs,
    total,
    page,
    totalPages,
    limit,
    search,
    entityFilter,
    actionFilter,
    appName,
}: {
    logs: AuditLog[];
    total: number;
    page: number;
    totalPages: number;
    limit: number;
    search: string;
    entityFilter: string;
    actionFilter: string;
    appName: string;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [searchInput, setSearchInput] = useState(search);

    const navigate = useCallback((params: Record<string, string>) => {
        const sp = new URLSearchParams();
        if (params.search) sp.set("search", params.search);
        if (params.entity) sp.set("entity", params.entity);
        if (params.action) sp.set("action", params.action);
        if (params.page && params.page !== "1") sp.set("page", params.page);
        router.push(`${pathname}?${sp.toString()}`);
    }, [router, pathname]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        navigate({ search: searchInput, entity: entityFilter, action: actionFilter, page: "1" });
    };

    return (
        <div className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Governance"
                title="Audit log"
                description={`Rekam jejak seluruh aktivitas sistem ${appName}`}
                actions={
                    <div className="inline-flex items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-sm tabular-nums text-ops-muted">
                        <Activity aria-hidden="true" className="size-4 text-ops-info" />
                        Total <strong className="font-semibold text-ops-text">{total.toLocaleString()}</strong> aktivitas tercatat
                    </div>
                }
            />

            {/* Filters */}
            <div className="ops-panel flex flex-col gap-3 p-4 sm:flex-row">
                <form onSubmit={handleSearch} className="flex flex-1 gap-2">
                    <div className="relative flex-1">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Cari username, entity name, detail..."
                            aria-label="Cari audit log"
                            className="ops-input h-9 w-full pl-9 pr-8 text-sm"
                        />
                        {searchInput && (
                            <button type="button" onClick={() => { setSearchInput(""); navigate({ entity: entityFilter, action: actionFilter }); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted transition-colors hover:text-ops-text" aria-label="Clear search">
                                <X aria-hidden="true" className="size-3.5" />
                            </button>
                        )}
                    </div>
                    <ActionButton type="submit" icon={<Search aria-hidden="true" className="size-4" />}>
                        Cari
                    </ActionButton>
                </form>

                <div className="flex flex-wrap gap-2">
                    <div className="relative">
                        <Filter aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ops-muted" />
                        <select
                            value={entityFilter}
                            onChange={e => navigate({ search, entity: e.target.value, action: actionFilter, page: "1" })}
                            aria-label="Filter entity"
                            className="ops-input h-9 cursor-pointer appearance-none pl-8 pr-3 text-sm"
                        >
                            <option value="">Semua Entity</option>
                            {ALL_ENTITIES.map(e => <option key={e} value={e}>{ENTITY_LABELS[e]}</option>)}
                        </select>
                    </div>

                    <select
                        value={actionFilter}
                        onChange={e => navigate({ search, entity: entityFilter, action: e.target.value, page: "1" })}
                        aria-label="Filter aksi"
                        className="ops-input h-9 cursor-pointer appearance-none px-3 text-sm"
                    >
                        <option value="">Semua Aksi</option>
                        {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>

                    {(search || entityFilter || actionFilter) && (
                        <ActionButton type="button" variant="danger" onClick={() => { setSearchInput(""); navigate({}); }} icon={<X aria-hidden="true" className="size-4" />}>
                            Reset
                        </ActionButton>
                    )}
                </div>
            </div>

            {/* Table */}
            {logs.length === 0 ? (
                <EmptyState
                    icon={<Shield aria-hidden="true" />}
                    title="Belum ada aktivitas yang tercatat"
                />
            ) : (
                <DataTableFrame>
                    <DataTable>
                        <DataTableHead>
                            <tr>
                                <th className="px-4 py-3 text-left">Waktu</th>
                                <th className="px-4 py-3 text-left">User</th>
                                <th className="px-4 py-3 text-left">Aksi</th>
                                <th className="px-4 py-3 text-left">Entity</th>
                                <th className="px-4 py-3 text-left">Target</th>
                                <th className="px-4 py-3 text-left">Detail</th>
                                <th className="px-4 py-3 text-left">Site</th>
                            </tr>
                        </DataTableHead>
                        <DataTableBody>
                            {logs.map(log => (
                                <tr key={log.id}>
                                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-ops-muted">
                                        <div className="flex items-center gap-1.5">
                                            <Clock aria-hidden="true" className="size-3 shrink-0" />
                                            {formatDate(log.createdAt)}
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">
                                        <div className="flex items-center gap-1.5">
                                            <User aria-hidden="true" className="size-3.5 shrink-0 text-ops-subtle" />
                                            <div>
                                                <p className="text-xs font-medium text-ops-text">{log.username ?? "-"}</p>
                                                <p className="text-[11px] text-ops-subtle">{log.userRole ?? ""}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">
                                        <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${ACTION_COLORS[log.action] ?? "border-ops-border-strong bg-ops-surface-raised text-ops-muted"}`}>
                                            {ACTION_ICONS[log.action] ?? <Activity aria-hidden="true" className="size-3" />}
                                            {log.action}
                                        </span>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">
                                        {log.entity && (
                                            <span className="inline-flex items-center gap-1 rounded-sm border border-ops-border bg-ops-surface-raised/50 px-2 py-0.5 text-[11px] text-ops-muted">
                                                <Tag aria-hidden="true" className="size-2.5" />
                                                {ENTITY_LABELS[log.entity] ?? log.entity}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="text-xs font-medium text-ops-text">{log.entityName ?? "-"}</p>
                                        {log.entityId && <p className="text-[11px] tabular-nums text-ops-subtle">ID: {log.entityId}</p>}
                                    </td>
                                    <td className="max-w-[200px] px-4 py-3">
                                        <p className="truncate text-xs text-ops-muted" title={log.detail ?? ""}>{log.detail ?? "-"}</p>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ops-subtle">
                                        {log.siteName ?? "-"}
                                    </td>
                                </tr>
                            ))}
                        </DataTableBody>
                    </DataTable>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-ops-border px-4 py-3">
                            <p className="text-xs tabular-nums text-ops-subtle">
                                Menampilkan {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} dari {total.toLocaleString()} aktivitas
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => navigate({ search, entity: entityFilter, action: actionFilter, page: String(page - 1) })}
                                    disabled={page <= 1}
                                    className="flex size-7 items-center justify-center rounded-md text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:pointer-events-none disabled:opacity-30"
                                    aria-label="Previous page"
                                >
                                    <ChevronLeft aria-hidden="true" className="size-4" />
                                </button>
                                <span className="px-2 text-xs tabular-nums text-ops-muted">Hal {page} / {totalPages}</span>
                                <button
                                    type="button"
                                    onClick={() => navigate({ search, entity: entityFilter, action: actionFilter, page: String(page + 1) })}
                                    disabled={page >= totalPages}
                                    className="flex size-7 items-center justify-center rounded-md text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:pointer-events-none disabled:opacity-30"
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
