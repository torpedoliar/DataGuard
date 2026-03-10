"use client";

import { deleteUser } from "@/actions/users";
import { useState, useMemo, useTransition } from "react";
import { Trash2, Edit, Shield, Mail, Calendar, LogIn, Search, ArrowUpDown, ArrowUp, ArrowDown, X, Filter, Key, Database } from "lucide-react";
import EditUserForm from "./edit-user-form";
import ResetPasswordModal from "./reset-password-modal";

type Site = { id: number; name: string; code: string };

type User = {
    id: number;
    username: string;
    email: string | null;
    role: "superadmin" | "admin" | "staff";
    isActive: boolean | null;
    lastLogin: Date | null;
    createdAt: Date | null;
    sites?: Site[];
};

type SortKey = "username" | "role" | "lastLogin" | "createdAt";
type SortDir = "asc" | "desc";

export default function UserTable({ users, sites, currentUserId }: { users: User[]; sites: Site[]; currentUserId: number }) {
    const [isPending, startTransition] = useTransition();
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [resettingUser, setResettingUser] = useState<User | null>(null);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<string>("All");
    const [statusFilter, setStatusFilter] = useState<string>("All");
    const [sortKey, setSortKey] = useState<SortKey>("username");
    const [sortDir, setSortDir] = useState<SortDir>("asc");

    const handleDelete = (id: number, username: string) => {
        if (confirm(`Are you sure you want to delete user "${username}"?`)) {
            setDeletingId(id);
            startTransition(async () => {
                await deleteUser(id);
                setDeletingId(null);
            });
        }
    };

    const formatDate = (date: Date | null) => {
        if (!date) return "Never";
        return new Date(date).toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    };

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(key); setSortDir("asc"); }
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-600" />;
        return sortDir === "asc"
            ? <ArrowUp className="h-3.5 w-3.5 text-blue-400" />
            : <ArrowDown className="h-3.5 w-3.5 text-blue-400" />;
    };

    const filtered = useMemo(() => {
        let data = users;
        if (search.trim()) {
            const q = search.toLowerCase();
            data = data.filter(u =>
                u.username.toLowerCase().includes(q) ||
                (u.email || "").toLowerCase().includes(q)
            );
        }
        if (roleFilter !== "All") data = data.filter(u => u.role === roleFilter);
        if (statusFilter !== "All") data = data.filter(u => statusFilter === "Active" ? u.isActive : !u.isActive);

        data = [...data].sort((a, b) => {
            let cmp = 0;
            if (sortKey === "username") cmp = a.username.localeCompare(b.username);
            else if (sortKey === "role") cmp = a.role.localeCompare(b.role);
            else if (sortKey === "lastLogin") cmp = (a.lastLogin?.getTime() || 0) - (b.lastLogin?.getTime() || 0);
            else if (sortKey === "createdAt") cmp = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
            return sortDir === "asc" ? cmp : -cmp;
        });
        return data;
    }, [users, search, roleFilter, statusFilter, sortKey, sortDir]);

    const hasFilters = search || roleFilter !== "All" || statusFilter !== "All";

    return (
        <>
            <div className="glow-card overflow-hidden">
                {/* Toolbar */}
                <div className="p-4 border-b border-slate-700/50 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search users..."
                                className="w-full h-9 pl-9 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            />
                            {search && (
                                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="All">All Roles</option>
                            <option value="superadmin">Superadmin</option>
                            <option value="admin">Admin</option>
                            <option value="staff">Staff</option>
                        </select>
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="All">All Status</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>
                        {hasFilters && (
                            <button onClick={() => { setSearch(""); setRoleFilter("All"); setStatusFilter("All"); }} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                                <X className="h-3 w-3" /> Clear
                            </button>
                        )}
                    </div>
                    <span className="text-xs text-slate-500 font-medium shrink-0">{filtered.length} of {users.length} Users</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                            <tr>
                                <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("username")}>
                                    <span className="inline-flex items-center gap-1.5">User <SortIcon col="username" /></span>
                                </th>
                                <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("role")}>
                                    <span className="inline-flex items-center gap-1.5">Role <SortIcon col="role" /></span>
                                </th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("lastLogin")}>
                                    <span className="inline-flex items-center gap-1.5">Last Login <SortIcon col="lastLogin" /></span>
                                </th>
                                <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                                    <span className="inline-flex items-center gap-1.5">Created <SortIcon col="createdAt" /></span>
                                </th>
                                <th className="px-5 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                                        {hasFilters ? "No users match your filters." : "No users found. Add one above."}
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((user) => (
                                    <tr key={user.id} className={`hover:bg-slate-800/30 transition-colors ${user.id === currentUserId ? "bg-blue-500/5" : ""}`}>
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="size-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                                    {user.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-white">
                                                        {user.username}
                                                        {user.id === currentUserId && (
                                                            <span className="ml-1.5 text-[10px] text-blue-400">(You)</span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-slate-500 flex items-center gap-1">
                                                        <Mail className="h-3 w-3" /> {user.email || "No email"}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            <div>
                                                <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${user.role === "superadmin" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                                    : user.role === "admin" ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                                        : "bg-slate-700 text-slate-300 border border-slate-600"
                                                    }`}>
                                                    <Shield className="h-3 w-3" /> {user.role}
                                                </span>
                                            </div>
                                            {user.role !== "superadmin" && user.sites && user.sites.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {user.sites.map(site => (
                                                        <span key={site.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                                            <Database className="h-2.5 w-2.5" />
                                                            {site.code}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${user.isActive ? "pill-ok" : "pill-error"}`}>
                                                <span className={`size-1.5 rounded-full ${user.isActive ? "bg-green-500" : "bg-red-500"}`} />
                                                {user.isActive ? "Active" : "Inactive"}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 whitespace-nowrap text-slate-400 text-xs">
                                            {formatDate(user.lastLogin)}
                                        </td>
                                        <td className="px-5 py-3 whitespace-nowrap text-slate-400 text-xs">
                                            {formatDate(user.createdAt)}
                                        </td>
                                        <td className="px-5 py-3 whitespace-nowrap text-right">
                                            <div className="inline-flex items-center gap-1">
                                                <button onClick={() => setResettingUser(user)} className="p-1.5 rounded-lg hover:bg-slate-700 text-amber-400 transition-colors" title="Reset Password">
                                                    <Key className="h-4 w-4" />
                                                </button>
                                                <button onClick={() => setEditingUser(user)} className="p-1.5 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(user.id, user.username)}
                                                    disabled={isPending && deletingId === user.id || user.id === currentUserId}
                                                    className={`p-1.5 rounded-lg transition-colors ${user.id === currentUserId ? "text-slate-700 cursor-not-allowed" : "hover:bg-slate-700 text-red-400"}`}
                                                    title={user.id === currentUserId ? "Cannot delete your own account" : "Delete"}
                                                >
                                                    {isPending && deletingId === user.id
                                                        ? <span className="text-xs text-slate-400">...</span>
                                                        : <Trash2 className="h-4 w-4" />
                                                    }
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div >

            {editingUser && <EditUserForm user={editingUser} sites={sites} onClose={() => setEditingUser(null)} />
            }
            {resettingUser && <ResetPasswordModal user={resettingUser} onClose={() => setResettingUser(null)} />}
        </>
    );
}
