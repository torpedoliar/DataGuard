"use client";

import { useEffect, useState, useMemo, useTransition } from "react";
import { getSites, addSite, updateSite, deleteSite, getSiteUsers, getUnassignedUsers, assignUserToSite, updateUserSiteRole, removeUserFromSite } from "@/actions/sites";
import { migrateToMultiSite } from "@/actions/migrate-multisite";
import { Building2, Plus, Pencil, Trash2, Users, Loader2, UserPlus, ShieldCheck, ShieldAlert, X } from "lucide-react";

type Site = {
    id: number; name: string; code: string; address: string | null;
    description: string | null; telegramChatId: string | null; isActive: boolean | null; createdAt: Date | null;
};
type SiteUser = {
    assignmentId: number; userId: number; username: string; email: string | null;
    globalRole: string; roleInSite: string; isActive: boolean | null;
};
type UnassignedUser = { id: number; username: string; email: string | null; role: string };

export default function SiteManagementPage() {
    const [sites, setSites] = useState<Site[]>([]);
    const [isPending, startTransition] = useTransition();
    const [showAddForm, setShowAddForm] = useState(false);
    const [editSite, setEditSite] = useState<Site | null>(null);
    const [manageSite, setManageSite] = useState<Site | null>(null);
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
            const res = await addSite({ name: formName, code: formCode, address: formAddress, description: formDescription, telegramChatId: formTelegramChatId });
            if (res.success) {
                setSuccess(res.message); setShowAddForm(false);
                setFormName(""); setFormCode(""); setFormAddress(""); setFormDescription(""); setFormTelegramChatId("");
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
            const res = await updateSite(editSite.id, { name: formName, code: formCode, address: formAddress, description: formDescription, telegramChatId: formTelegramChatId });
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
    };

    const startAdd = () => {
        setShowAddForm(true); setEditSite(null);
        setFormName(""); setFormCode(""); setFormAddress(""); setFormDescription(""); setFormTelegramChatId("");
    };

    return (
        <main className="mx-auto max-w-6xl px-6 py-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                        <Building2 className="h-7 w-7 text-primary" />
                        Site Management
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Kelola data center / lokasi site dan user yang ditugaskan.</p>
                </div>
                <button onClick={startAdd} className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-sm">
                    <Plus className="h-4 w-4" /> Tambah Site
                </button>
            </div>

            {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>}
            {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm">{success}</div>}

            {/* Add / Edit Form */}
            {(showAddForm || editSite) && (
                <div className="mb-6 bg-white dark:bg-card-dark rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
                    <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white">
                        {editSite ? "Edit Site" : "Tambah Site Baru"}
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Nama Site *</label>
                            <input value={formName} onChange={e => setFormName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm" placeholder="Data Center Jakarta" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Kode Site *</label>
                            <input value={formCode} onChange={e => setFormCode(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm uppercase" placeholder="DC-JKT" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Alamat</label>
                            <input value={formAddress} onChange={e => setFormAddress(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm" placeholder="Jl. Sudirman No.1" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Deskripsi</label>
                            <input value={formDescription} onChange={e => setFormDescription(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm" placeholder="Main production DC" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Telegram Chat ID (Optional)</label>
                            <input value={formTelegramChatId} onChange={e => setFormTelegramChatId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm font-mono" placeholder="-100123456789" />
                            <p className="text-xs text-slate-500 mt-1">If set, critical audit alerts (Error/Warning) will be sent to this group or user.</p>
                        </div>
                    </div>
                    <div className="mt-4 flex gap-3">
                        <button onClick={editSite ? handleUpdate : handleAdd} disabled={isPending} className="bg-primary text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50">
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editSite ? "Simpan" : "Tambah"}
                        </button>
                        <button onClick={() => { setShowAddForm(false); setEditSite(null); }} className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm">
                            Batal
                        </button>
                    </div>
                </div>
            )}

            {/* Sites Table */}
            <div className="glow-card overflow-hidden">
                {/* Toolbar */}
                <div className="p-4 border-b border-slate-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-slate-500">search</span>
                            <input
                                value={siteSearch}
                                onChange={e => setSiteSearch(e.target.value)}
                                placeholder="Search sites..."
                                className="w-full h-9 pl-9 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            />
                            {siteSearch && (
                                <button onClick={() => setSiteSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                        <select value={siteStatusFilter} onChange={e => setSiteStatusFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="All">All Status</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>
                    </div>
                    <span className="text-xs text-slate-500 font-medium shrink-0">{filteredSites.length} of {sites.length} Sites</span>
                </div>

                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                            <th className="text-left px-5 py-3 cursor-pointer select-none" onClick={() => setSiteSortDir(d => d === "asc" ? "desc" : "asc")}>
                                <span className="inline-flex items-center gap-1.5">
                                    Nama
                                    <span className="material-symbols-outlined text-[14px] text-blue-400">{siteSortDir === "asc" ? "arrow_upward" : "arrow_downward"}</span>
                                </span>
                            </th>
                            <th className="text-left px-5 py-3">Kode</th>
                            <th className="text-left px-5 py-3 hidden md:table-cell">Alamat</th>
                            <th className="text-center px-5 py-3">Status</th>
                            <th className="text-right px-5 py-3">Aksi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {filteredSites.length === 0 && (
                            <tr>
                                <td colSpan={5} className="text-center py-12">
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="text-slate-500 dark:text-slate-400">
                                            Belum ada site terdaftar. Anda bisa klik &quot;Tambah Site&quot; di atas, atau mengaktifkan mode Multi-Site dengan memigrasi data lama Anda.
                                        </div>
                                        <button onClick={handleMigrate} disabled={isPending} className="flex items-center gap-2 bg-amber-500 text-white px-5 py-2.5 rounded-lg hover:bg-amber-600 transition font-medium text-sm shadow-lg shadow-amber-500/20 disabled:opacity-50">
                                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                            Migrasi Data Lama
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                        {filteredSites.map(site => (
                            <tr key={site.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                                <td className="px-6 py-4 font-medium text-slate-800 dark:text-white">{site.name}</td>
                                <td className="px-6 py-4"><span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono font-bold">{site.code}</span></td>
                                <td className="px-6 py-4 text-slate-500 dark:text-slate-400 hidden md:table-cell">{site.address || "-"}</td>
                                <td className="px-6 py-4 text-center">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${site.isActive ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"}`}>
                                        {site.isActive ? "Aktif" : "Nonaktif"}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-end gap-2">
                                        <button onClick={() => openUserManager(site)} className="p-2 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg transition" title="Kelola User">
                                            <Users className="h-4 w-4" />
                                        </button>
                                        <button onClick={() => startEdit(site)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition" title="Edit">
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button onClick={() => handleDelete(site.id)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition" title="Hapus">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* User Assignment Modal */}
            {manageSite && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setManageSite(null)}>
                    <div className="bg-white dark:bg-card-dark rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Users className="h-5 w-5 text-violet-500" />
                                    User di {manageSite.name}
                                </h3>
                                <p className="text-sm text-slate-500 mt-0.5">Atur siapa yang bisa mengakses site ini.</p>
                            </div>
                            <button onClick={() => setManageSite(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">
                                <X className="h-5 w-5 text-slate-400" />
                            </button>
                        </div>

                        {/* Current Users */}
                        <div className="p-6">
                            <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-3">User Terdaftar ({siteUsers.length})</h4>
                            {siteUsers.length === 0 ? (
                                <p className="text-sm text-slate-400 py-4 text-center">Belum ada user yang ditugaskan ke site ini.</p>
                            ) : (
                                <div className="space-y-2">
                                    {siteUsers.map(u => (
                                        <div key={u.assignmentId} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-white">
                                                    {u.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <span className="font-medium text-slate-800 dark:text-white text-sm">{u.username}</span>
                                                    {u.email && <span className="text-xs text-slate-400 ml-2">{u.email}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <select
                                                    value={u.roleInSite}
                                                    onChange={e => handleRoleChange(u.assignmentId, e.target.value as "admin" | "staff")}
                                                    className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                                                >
                                                    <option value="staff">Staff</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                                <button onClick={() => handleRemove(u.assignmentId)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add User */}
                            {unassigned.length > 0 && (
                                <div className="mt-6">
                                    <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" /> Tambahkan User
                                    </h4>
                                    <div className="space-y-2">
                                        {unassigned.map(u => (
                                            <div key={u.id} className="flex items-center justify-between p-3 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400">
                                                        {u.username.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <span className="text-sm text-slate-700 dark:text-slate-300">{u.username}</span>
                                                        <span className="text-xs text-slate-400 ml-2">({u.role})</span>
                                                    </div>
                                                </div>
                                                <button onClick={() => handleAssign(u.id)} disabled={isPending} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition disabled:opacity-50">
                                                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
