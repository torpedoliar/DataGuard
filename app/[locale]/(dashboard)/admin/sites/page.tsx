"use client";

import { useEffect, useState, useMemo, useTransition } from "react";
import { getSites, addSite, updateSite, deleteSite, getSiteUsers, getUnassignedUsers, assignUserToSite, updateUserSiteRole, removeUserFromSite } from "@/actions/sites";
import { migrateToMultiSite } from "@/actions/migrate-multisite";
import SiteTelegramChats from "@/components/admin/site-telegram-chats";
import ActionButton from "@/components/ui/action-button";
import { DataTable, DataTableBody, DataTableFrame, DataTableHead } from "@/components/ui/data-table";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import StatusBadge from "@/components/ui/status-badge";
import { Building2, Plus, Pencil, Trash2, Users, Loader2, UserPlus, ShieldCheck, X, Send, Search, ArrowUp, ArrowDown } from "lucide-react";

type Site = {
    id: number; name: string; code: string; address: string | null;
    description: string | null; telegramChatId: string | null;
    latitude: string | null; longitude: string | null;
    isActive: boolean | null; createdAt: Date | null;
};
type SiteUser = {
    assignmentId: number; userId: number; username: string; email: string | null;
    globalRole: string; roleInSite: string; isActive: boolean | null;
};
type UnassignedUser = { id: number; username: string; email: string | null; role: string };

const fieldClass = "ops-input h-9 w-full px-3 text-sm";
const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";
const hintClass = "mt-1 text-xs text-ops-muted";

export default function SiteManagementPage() {
    const [sites, setSites] = useState<Site[]>([]);
    const [isPending, startTransition] = useTransition();
    const [showAddForm, setShowAddForm] = useState(false);
    const [editSite, setEditSite] = useState<Site | null>(null);
    const [manageSite, setManageSite] = useState<Site | null>(null);
    const [telegramSite, setTelegramSite] = useState<Site | null>(null);
    const [siteUsers, setSiteUsers] = useState<SiteUser[]>([]);
    const [unassigned, setUnassigned] = useState<UnassignedUser[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form state
    const [formName, setFormName] = useState("");
    const [formCode, setFormCode] = useState("");
    const [formAddress, setFormAddress] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formTelegramChatId, setFormTelegramChatId] = useState("");
    const [formLatitude, setFormLatitude] = useState("");
    const [formLongitude, setFormLongitude] = useState("");

    // Search, filter, sort state for sites table
    const [siteSearch, setSiteSearch] = useState("");
    const [siteStatusFilter, setSiteStatusFilter] = useState("All");
    const [siteSortDir, setSiteSortDir] = useState<"asc" | "desc">("asc");

    const filteredSites = useMemo(() => {
        let data = sites;
        if (siteSearch.trim()) {
            const q = siteSearch.toLowerCase();
            data = data.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.code.toLowerCase().includes(q) ||
                (s.address || "").toLowerCase().includes(q)
            );
        }
        if (siteStatusFilter !== "All") data = data.filter(s => siteStatusFilter === "Active" ? s.isActive : !s.isActive);
        data = [...data].sort((a, b) => {
            const cmp = a.name.localeCompare(b.name);
            return siteSortDir === "asc" ? cmp : -cmp;
        });
        return data;
    }, [sites, siteSearch, siteStatusFilter, siteSortDir]);

    const loadSites = () => {
        startTransition(async () => {
            const data = await getSites();
            setSites(data as Site[]);
        });
    };

    useEffect(() => { loadSites(); }, []);

    const handleAdd = () => {
        setError(null); setSuccess(null);
        startTransition(async () => {
            const res = await addSite({ name: formName, code: formCode, address: formAddress, description: formDescription, telegramChatId: formTelegramChatId, latitude: formLatitude, longitude: formLongitude });
            if (res.success) {
                setSuccess(res.message); setShowAddForm(false);
                setFormName(""); setFormCode(""); setFormAddress(""); setFormDescription(""); setFormTelegramChatId(""); setFormLatitude(""); setFormLongitude("");
                loadSites();
            } else { setError(res.message || "Gagal"); }
        });
    };

    const handleMigrate = () => {
        if (!confirm("Fitur ini akan membuat 'Site Default' dan memindahkan SEMUA data lama Anda ke site tersebut. Lanjutkan?")) return;
        setError(null); setSuccess(null);
        startTransition(async () => {
            const res = await migrateToMultiSite();
            if (res.success || res.skipped) {
                setSuccess(res.message);
                loadSites();
            } else {
                setError("Gagal melakukan migrasi data.");
            }
        });
    };

    const handleUpdate = () => {
        if (!editSite) return;
        setError(null);
        startTransition(async () => {
            const res = await updateSite(editSite.id, { name: formName, code: formCode, address: formAddress, description: formDescription, telegramChatId: formTelegramChatId, latitude: formLatitude, longitude: formLongitude });
            if (res.success) { setEditSite(null); loadSites(); setSuccess("Site berhasil diperbarui!"); }
            else { setError(res.message || "Gagal"); }
        });
    };

    const handleDelete = (id: number) => {
        if (!confirm("Yakin ingin menghapus site ini?")) return;
        startTransition(async () => {
            const res = await deleteSite(id);
            if (res.success) { loadSites(); setSuccess("Site dihapus."); }
            else { setError(res.message || "Gagal menghapus"); }
        });
    };

    const openUserManager = (site: Site) => {
        setManageSite(site);
        startTransition(async () => {
            const [users, available] = await Promise.all([getSiteUsers(site.id), getUnassignedUsers(site.id)]);
            setSiteUsers(users as SiteUser[]);
            setUnassigned(available as UnassignedUser[]);
        });
    };

    const handleAssign = (userId: number) => {
        if (!manageSite) return;
        startTransition(async () => {
            await assignUserToSite(userId, manageSite.id, "staff");
            openUserManager(manageSite);
        });
    };

    const handleRoleChange = (assignmentId: number, newRole: "admin" | "staff") => {
        startTransition(async () => {
            await updateUserSiteRole(assignmentId, newRole);
            if (manageSite) openUserManager(manageSite);
        });
    };

    const handleRemove = (assignmentId: number) => {
        if (!confirm("Hapus user dari site ini?")) return;
        startTransition(async () => {
            await removeUserFromSite(assignmentId);
            if (manageSite) openUserManager(manageSite);
        });
    };

    const startEdit = (site: Site) => {
        setEditSite(site);
        setFormName(site.name); setFormCode(site.code);
        setFormAddress(site.address || ""); setFormDescription(site.description || "");
        setFormTelegramChatId(site.telegramChatId || "");
        setFormLatitude(site.latitude || ""); setFormLongitude(site.longitude || "");
    };

    const startAdd = () => {
        setShowAddForm(true); setEditSite(null);
        setFormName(""); setFormCode(""); setFormAddress(""); setFormDescription(""); setFormTelegramChatId(""); setFormLatitude(""); setFormLongitude("");
    };

    return (
        <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / Sites"
                title="Site management"
                description="Kelola data center / lokasi site dan user yang ditugaskan."
                actions={
                    <ActionButton type="button" onClick={startAdd} icon={<Plus aria-hidden="true" className="size-4" />}>
                        Tambah Site
                    </ActionButton>
                }
            />

            {error && (
                <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger" role="alert">
                    {error}
                </div>
            )}
            {success && (
                <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success" role="status">
                    {success}
                </div>
            )}

            {/* Add / Edit Form */}
            {(showAddForm || editSite) && (
                <div className="ops-panel p-5">
                    <h2 className="mb-4 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                        {editSite ? "Edit Site" : "Tambah Site Baru"}
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label htmlFor="site-name" className={labelClass}>Nama Site *</label>
                            <input id="site-name" value={formName} onChange={e => setFormName(e.target.value)} className={fieldClass} placeholder="Data Center Jakarta" />
                        </div>
                        <div>
                            <label htmlFor="site-code" className={labelClass}>Kode Site *</label>
                            <input id="site-code" value={formCode} onChange={e => setFormCode(e.target.value)} className={`${fieldClass} font-mono uppercase`} placeholder="DC-JKT" />
                        </div>
                        <div>
                            <label htmlFor="site-address" className={labelClass}>Alamat</label>
                            <input id="site-address" value={formAddress} onChange={e => setFormAddress(e.target.value)} className={fieldClass} placeholder="Jl. Sudirman No.1" />
                        </div>
                        <div>
                            <label htmlFor="site-description" className={labelClass}>Deskripsi</label>
                            <input id="site-description" value={formDescription} onChange={e => setFormDescription(e.target.value)} className={fieldClass} placeholder="Main production DC" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="site-telegram" className={labelClass}>Telegram Chat ID (Optional)</label>
                            <input id="site-telegram" value={formTelegramChatId} onChange={e => setFormTelegramChatId(e.target.value)} className={`${fieldClass} font-mono`} placeholder="-100123456789" />
                            <p className={hintClass}>If set, critical audit alerts (Error/Warning) will be sent to this group or user.</p>
                        </div>
                        <div>
                            <label htmlFor="site-latitude" className={labelClass}>Latitude (Peta)</label>
                            <input id="site-latitude" value={formLatitude} onChange={e => setFormLatitude(e.target.value)} className={`${fieldClass} font-mono tabular-nums`} placeholder="-6.2088" />
                            <p className={hintClass}>Gunakan format desimal, contoh: -6.2088</p>
                        </div>
                        <div>
                            <label htmlFor="site-longitude" className={labelClass}>Longitude (Peta)</label>
                            <input id="site-longitude" value={formLongitude} onChange={e => setFormLongitude(e.target.value)} className={`${fieldClass} font-mono tabular-nums`} placeholder="106.8456" />
                            <p className={hintClass}>Gunakan format desimal, contoh: 106.8456</p>
                        </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                        <ActionButton type="button" onClick={editSite ? handleUpdate : handleAdd} isPending={isPending} icon={editSite ? undefined : <Plus aria-hidden="true" className="size-4" />}>
                            {isPending ? null : editSite ? "Simpan" : "Tambah"}
                        </ActionButton>
                        <ActionButton type="button" variant="secondary" onClick={() => { setShowAddForm(false); setEditSite(null); }}>
                            Batal
                        </ActionButton>
                    </div>
                </div>
            )}

            {/* Sites Table */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
                        <div className="relative w-full sm:w-64">
                            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                            <input
                                value={siteSearch}
                                onChange={e => setSiteSearch(e.target.value)}
                                placeholder="Search sites..."
                                aria-label="Search sites"
                                className="ops-input h-9 w-full pl-9 pr-8 text-sm"
                            />
                            {siteSearch && (
                                <button type="button" onClick={() => setSiteSearch("")} aria-label="Clear search" title="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted transition-colors hover:text-ops-text">
                                    <X aria-hidden="true" className="size-3.5" />
                                </button>
                            )}
                        </div>
                        <select value={siteStatusFilter} onChange={e => setSiteStatusFilter(e.target.value)} aria-label="Filter status" className="ops-input h-9 px-3 text-sm">
                            <option value="All">All Status</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>
                    </div>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-ops-muted">{filteredSites.length} of {sites.length} sites</span>
                </div>

                {filteredSites.length === 0 ? (
                    <EmptyState
                        icon={<Building2 aria-hidden="true" />}
                        title="Belum ada site terdaftar"
                        description={'Anda bisa klik "Tambah Site" di atas, atau mengaktifkan mode Multi-Site dengan memigrasi data lama Anda.'}
                        action={
                            <button
                                type="button"
                                onClick={handleMigrate}
                                disabled={isPending}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3.5 text-sm font-medium text-ops-warning transition-colors hover:border-ops-warning/45 hover:bg-ops-warning/15 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ops-accent/30 disabled:pointer-events-none disabled:opacity-55"
                            >
                                {isPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
                                Migrasi Data Lama
                            </button>
                        }
                    />
                ) : (
                    <DataTableFrame>
                        <DataTable className="whitespace-nowrap">
                            <DataTableHead>
                                <tr>
                                    <th className="px-5 py-3 text-left">
                                        <button type="button" onClick={() => setSiteSortDir(d => d === "asc" ? "desc" : "asc")} className="inline-flex items-center gap-1.5 transition-colors hover:text-ops-text">
                                            Nama
                                            {siteSortDir === "asc" ? <ArrowUp aria-hidden="true" className="size-3.5 text-ops-accent" /> : <ArrowDown aria-hidden="true" className="size-3.5 text-ops-accent" />}
                                        </button>
                                    </th>
                                    <th className="px-5 py-3 text-left">Kode</th>
                                    <th className="hidden px-5 py-3 text-left md:table-cell">Alamat</th>
                                    <th className="px-5 py-3 text-center">Status</th>
                                    <th className="px-5 py-3 text-right">Aksi</th>
                                </tr>
                            </DataTableHead>
                            <DataTableBody>
                                {filteredSites.map(site => (
                                    <tr key={site.id}>
                                        <td className="px-5 py-3 font-medium text-ops-text">{site.name}</td>
                                        <td className="px-5 py-3">
                                            <span className="rounded-sm bg-ops-info-soft px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-ops-info">{site.code}</span>
                                        </td>
                                        <td className="hidden px-5 py-3 text-ops-muted md:table-cell">{site.address || "-"}</td>
                                        <td className="px-5 py-3 text-center">
                                            <StatusBadge tone={site.isActive ? "success" : "danger"} dot>
                                                {site.isActive ? "Aktif" : "Nonaktif"}
                                            </StatusBadge>
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center justify-end gap-1">
                                                <ActionButton type="button" variant="ghost" size="icon" onClick={() => setTelegramSite(site)} aria-label="Telegram recipients" title="Telegram Recipients">
                                                    <Send aria-hidden="true" className="size-4 text-ops-info" />
                                                </ActionButton>
                                                <ActionButton type="button" variant="ghost" size="icon" onClick={() => openUserManager(site)} aria-label="Kelola user" title="Kelola User">
                                                    <Users aria-hidden="true" className="size-4 text-ops-accent" />
                                                </ActionButton>
                                                <ActionButton type="button" variant="ghost" size="icon" onClick={() => startEdit(site)} aria-label="Edit site" title="Edit">
                                                    <Pencil aria-hidden="true" className="size-4 text-ops-info" />
                                                </ActionButton>
                                                <ActionButton type="button" variant="danger" size="icon" onClick={() => handleDelete(site.id)} aria-label="Hapus site" title="Hapus">
                                                    <Trash2 aria-hidden="true" className="size-4" />
                                                </ActionButton>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </DataTableBody>
                        </DataTable>
                    </DataTableFrame>
                )}
            </div>

            {/* User Assignment Modal */}
            {manageSite && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={() => setManageSite(null)}>
                    <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)]" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                                    <Users aria-hidden="true" className="size-4 text-ops-accent" />
                                    User di {manageSite.name}
                                </h3>
                                <p className="mt-0.5 text-[13px] text-ops-muted">Atur siapa yang bisa mengakses site ini.</p>
                            </div>
                            <ActionButton type="button" variant="ghost" size="icon" onClick={() => setManageSite(null)} aria-label="Close dialog" title="Close">
                                <X aria-hidden="true" className="size-4" />
                            </ActionButton>
                        </div>

                        {/* Current Users */}
                        <div className="p-5">
                            <h4 className="mb-3 text-xs font-medium text-ops-muted">User terdaftar <span className="tabular-nums">({siteUsers.length})</span></h4>
                            {siteUsers.length === 0 ? (
                                <p className="py-4 text-center text-sm text-ops-muted">Belum ada user yang ditugaskan ke site ini.</p>
                            ) : (
                                <div className="space-y-2">
                                    {siteUsers.map(u => (
                                        <div key={u.assignmentId} className="ops-panel-subtle flex items-center justify-between p-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex size-8 items-center justify-center rounded-full bg-ops-surface-sunken text-xs font-semibold text-ops-text">
                                                    {u.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <span className="text-sm font-medium text-ops-text">{u.username}</span>
                                                    {u.email && <span className="ml-2 text-xs text-ops-muted">{u.email}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <select
                                                    value={u.roleInSite}
                                                    onChange={e => handleRoleChange(u.assignmentId, e.target.value as "admin" | "staff")}
                                                    aria-label={`Role ${u.username}`}
                                                    className="ops-input h-8 px-2 text-xs"
                                                >
                                                    <option value="staff">Staff</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                                <ActionButton type="button" variant="danger" size="icon" onClick={() => handleRemove(u.assignmentId)} aria-label={`Hapus ${u.username}`} title="Hapus" className="size-8">
                                                    <Trash2 aria-hidden="true" className="size-3.5" />
                                                </ActionButton>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add User */}
                            {unassigned.length > 0 && (
                                <div className="mt-6">
                                    <h4 className="mb-3 flex items-center gap-2 text-xs font-medium text-ops-muted">
                                        <UserPlus aria-hidden="true" className="size-4" /> Tambahkan user
                                    </h4>
                                    <div className="space-y-2">
                                        {unassigned.map(u => (
                                            <div key={u.id} className="flex items-center justify-between rounded-lg border border-dashed border-ops-border p-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex size-8 items-center justify-center rounded-full bg-ops-info-soft text-xs font-semibold text-ops-info">
                                                        {u.username.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <span className="text-sm text-ops-muted">{u.username}</span>
                                                        <span className="ml-2 text-xs text-ops-muted">({u.role})</span>
                                                    </div>
                                                </div>
                                                <ActionButton type="button" size="sm" onClick={() => handleAssign(u.id)} isPending={isPending}>
                                                    Assign
                                                </ActionButton>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Telegram Recipients Modal (N23) */}
            {telegramSite && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={() => setTelegramSite(null)}>
                    <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)]" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                                    <Send aria-hidden="true" className="size-4 text-ops-info" />
                                    Telegram Recipients &mdash; {telegramSite.name}
                                </h3>
                                <p className="mt-0.5 text-[13px] text-ops-muted">Kelola multi-recipient telegram untuk site ini.</p>
                            </div>
                            <ActionButton type="button" variant="ghost" size="icon" onClick={() => setTelegramSite(null)} aria-label="Close dialog" title="Close">
                                <X aria-hidden="true" className="size-4" />
                            </ActionButton>
                        </div>
                        <div className="p-5">
                            <SiteTelegramChats siteId={telegramSite.id} />
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
