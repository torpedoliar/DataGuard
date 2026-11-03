
"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, Shield, X, Filter, ChevronLeft, ChevronRight, Clock, User, Tag, Activity, Trash2, PenLine, Plus, LogIn, LogOut, RefreshCw, Upload } from "lucide-react";

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
    CREATE: <Plus className="h-3.5 w-3.5" />,
    UPDATE: <PenLine className="h-3.5 w-3.5" />,
    DELETE: <Trash2 className="h-3.5 w-3.5" />,
    LOGIN: <LogIn className="h-3.5 w-3.5" />,
    LOGOUT: <LogOut className="h-3.5 w-3.5" />,
    TOGGLE: <RefreshCw className="h-3.5 w-3.5" />,
    UPLOAD: <Upload className="h-3.5 w-3.5" />,
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
        <div className="max-w-[1600px] mx-auto px-5 py-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-ops-info-soft text-ops-info">
                        <Shield className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-ops-text">Audit Log</h1>
                        <p className="text-sm text-ops-muted">Rekam jejak seluruh aktivitas sistem {appName}</p>
                    </div>
                </div>

                {/* Stats */}
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ops-surface-raised/60 border border-ops-border/50 text-xs text-ops-muted">
                    <Activity className="h-3.5 w-3.5 text-ops-info" />
                    <span>Total <strong className="text-white">{total.toLocaleString()}</strong> aktivitas tercatat</span>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-surface border border-border rounded-xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
                <form onSubmit={handleSearch} className="flex flex-1 gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ops-subtle" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Cari username, entity name, detail..."
                            className="w-full h-9 pl-9 pr-8 rounded-lg bg-ops-surface-raised border border-ops-border text-sm text-white placeholder:text-ops-subtle focus:ring-1 focus:ring-ops-accent focus:border-ops-info outline-none"
                        />
                        {searchInput && (
                            <button type="button" onClick={() => { setSearchInput(""); navigate({ entity: entityFilter, action: actionFilter }); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-subtle hover:text-white">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <button type="submit" className="h-9 px-4 rounded-lg bg-ops-accent text-ops-accent-fg text-sm font-medium hover:bg-ops-accent-hover flex items-center gap-1.5">
                        <Search className="h-3.5 w-3.5" /> Cari
                    </button>
                </form>

                <div className="flex gap-2">
                    <div className="relative">
                        <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ops-subtle pointer-events-none" />
                        <select
                            value={entityFilter}
                            onChange={e => navigate({ search, entity: e.target.value, action: actionFilter, page: "1" })}
                            className="h-9 pl-8 pr-3 rounded-lg bg-ops-surface-raised border border-ops-border text-sm text-white focus:ring-1 focus:ring-ops-accent outline-none appearance-none cursor-pointer"
                        >
                            <option value="">Semua Entity</option>
                            {ALL_ENTITIES.map(e => <option key={e} value={e}>{ENTITY_LABELS[e]}</option>)}
                        </select>
                    </div>

                    <select
                        value={actionFilter}
                        onChange={e => navigate({ search, entity: entityFilter, action: e.target.value, page: "1" })}
                        className="h-9 px-3 rounded-lg bg-ops-surface-raised border border-ops-border text-sm text-white focus:ring-1 focus:ring-ops-accent outline-none appearance-none cursor-pointer"
                    >
                        <option value="">Semua Aksi</option>
                        {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>

                    {(search || entityFilter || actionFilter) && (
                        <button onClick={() => { setSearchInput(""); navigate({}); }} className="h-9 px-3 rounded-lg bg-ops-danger-soft text-ops-danger border border-ops-danger/20 text-sm hover:bg-ops-danger-soft flex items-center gap-1.5">
                            <X className="h-3.5 w-3.5" /> Reset
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted border-b border-border">
                            <tr>
                                <th className="px-4 py-3 text-left">Waktu</th>
                                <th className="px-4 py-3 text-left">User</th>
                                <th className="px-4 py-3 text-left">Aksi</th>
                                <th className="px-4 py-3 text-left">Entity</th>
                                <th className="px-4 py-3 text-left">Target</th>
                                <th className="px-4 py-3 text-left">Detail</th>
                                <th className="px-4 py-3 text-left">Site</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ops-border/50">
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center text-ops-subtle">
                                        <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                        <p>Belum ada aktivitas yang tercatat</p>
                                    </td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id} className="hover:bg-ops-surface-raised/20 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap text-xs text-ops-muted">
                                            <div className="flex items-center gap-1.5">
                                                <Clock className="h-3 w-3 shrink-0" />
                                                {formatDate(log.createdAt)}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5">
                                                <User className="h-3.5 w-3.5 text-ops-subtle shrink-0" />
                                                <div>
                                                    <p className="text-ops-text font-medium text-xs">{log.username ?? "-"}</p>
                                                    <p className="text-ops-subtle text-[10px]">{log.userRole ?? ""}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ACTION_COLORS[log.action] ?? "bg-ops-surface-raised text-muted border-ops-border-strong"}`}>
                                                {ACTION_ICONS[log.action] ?? <Activity className="h-3 w-3" />}
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {log.entity && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-ops-surface-raised/50 text-muted text-[10px] border border-ops-border">
                                                    <Tag className="h-2.5 w-2.5" />
                                                    {ENTITY_LABELS[log.entity] ?? log.entity}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-ops-text text-xs font-medium">{log.entityName ?? "-"}</p>
                                            {log.entityId && <p className="text-ops-subtle text-[10px]">ID: {log.entityId}</p>}
                                        </td>
                                        <td className="px-4 py-3 max-w-[200px]">
                                            <p className="text-ops-muted text-xs truncate" title={log.detail ?? ""}>{log.detail ?? "-"}</p>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-xs text-ops-subtle">
                                            {log.siteName ?? "-"}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-ops-border/50 flex items-center justify-between">
                        <p className="text-xs text-ops-subtle">
                            Menampilkan {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} dari {total.toLocaleString()} aktivitas
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => navigate({ search, entity: entityFilter, action: actionFilter, page: String(page - 1) })}
                                disabled={page <= 1}
                                className="h-7 w-7 rounded flex items-center justify-center text-ops-muted hover:bg-ops-surface-raised disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs text-ops-muted px-2">Hal {page} / {totalPages}</span>
                            <button
                                onClick={() => navigate({ search, entity: entityFilter, action: actionFilter, page: String(page + 1) })}
                                disabled={page >= totalPages}
                                className="h-7 w-7 rounded flex items-center justify-center text-ops-muted hover:bg-ops-surface-raised disabled:opacity-30 disabled:cursor-not-allowed"
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
