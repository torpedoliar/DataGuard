"use client";

import { deleteUser } from "@/actions/users";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { ArrowDown, ArrowUp, ArrowUpDown, Database, Edit, Key, Mail, Search, Shield, Trash2, X } from "lucide-react";
import { useMemo, useState, useTransition, type ReactNode } from "react";
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

const fieldClass = "ops-input h-9 px-3 text-sm";

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
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (column: SortKey) => {
    if (sortKey !== column) return <ArrowUpDown className="size-3.5 text-slate-600" />;
    return sortDir === "asc" ? <ArrowUp className="size-3.5 text-ops-accent" /> : <ArrowDown className="size-3.5 text-ops-accent" />;
  };

  const filtered = useMemo(() => {
    let data = users;
    if (search.trim()) {
      const query = search.toLowerCase();
      data = data.filter((user) =>
        user.username.toLowerCase().includes(query) ||
        (user.email || "").toLowerCase().includes(query),
      );
    }
    if (roleFilter !== "All") data = data.filter((user) => user.role === roleFilter);
    if (statusFilter !== "All") data = data.filter((user) => statusFilter === "Active" ? user.isActive : !user.isActive);

    data = [...data].sort((a, b) => {
      let compare = 0;
      if (sortKey === "username") compare = a.username.localeCompare(b.username);
      else if (sortKey === "role") compare = a.role.localeCompare(b.role);
      else if (sortKey === "lastLogin") compare = (a.lastLogin?.getTime() || 0) - (b.lastLogin?.getTime() || 0);
      else compare = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
      return sortDir === "asc" ? compare : -compare;
    });
    return data;
  }, [users, search, roleFilter, statusFilter, sortKey, sortDir]);

  const hasFilters = search || roleFilter !== "All" || statusFilter !== "All";

  return (
    <div className="space-y-3">
      <DataToolbar>
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users..." className={`${fieldClass} w-full pl-9 pr-8`} />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" title="Clear search">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={`${fieldClass} min-w-36`}>
              <option value="All">All Roles</option>
              <option value="superadmin">Superadmin</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${fieldClass} min-w-32`}>
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            {hasFilters && (
              <ActionButton type="button" variant="ghost" size="sm" onClick={() => { setSearch(""); setRoleFilter("All"); setStatusFilter("All"); }} icon={<X className="size-3.5" />}>
                Clear
              </ActionButton>
            )}
          </div>
          <span className="shrink-0 text-xs font-medium text-ops-muted">{filtered.length} of {users.length} Users</span>
        </div>
      </DataToolbar>

      <DataTableFrame>
        <DataTable className="whitespace-nowrap">
          <DataTableHead>
            <tr>
              <SortableHead label="User" onClick={() => handleSort("username")} icon={renderSortIcon("username")} />
              <SortableHead label="Role" onClick={() => handleSort("role")} icon={renderSortIcon("role")} />
              <th className="px-5 py-3 text-left">Status</th>
              <SortableHead label="Last Login" onClick={() => handleSort("lastLogin")} icon={renderSortIcon("lastLogin")} />
              <SortableHead label="Created" onClick={() => handleSort("createdAt")} icon={renderSortIcon("createdAt")} />
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={6} title={hasFilters ? "No users match your filters" : "No users found"} description="Add or adjust users from this admin area." />
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className={`transition-colors hover:bg-ops-surface ${user.id === currentUserId ? "bg-ops-accent/[0.045]" : ""}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ops-accent text-xs font-bold text-slate-950">
                        {user.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-ops-text">
                          {user.username}
                          {user.id === currentUserId && <span className="ml-1.5 text-[10px] text-ops-accent">(You)</span>}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-ops-muted">
                          <Mail className="size-3" /> {user.email || "No email"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div>
                      <StatusBadge tone={user.role === "superadmin" ? "warning" : user.role === "admin" ? "purple" : "neutral"}>
                        <Shield className="size-3" /> {user.role}
                      </StatusBadge>
                    </div>
                    {user.role !== "superadmin" && user.sites && user.sites.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {user.sites.map((site) => (
                          <span key={site.id} className="inline-flex items-center gap-1 rounded-md border border-ops-border bg-ops-bg px-1.5 py-0.5 text-[10px] text-slate-300">
                            <Database className="size-2.5" />
                            {site.code}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge tone={user.isActive ? "success" : "danger"} dot>
                      {user.isActive ? "Active" : "Inactive"}
                    </StatusBadge>
                  </td>
                  <td className="px-5 py-3 text-xs text-ops-muted">{formatDate(user.lastLogin)}</td>
                  <td className="px-5 py-3 text-xs text-ops-muted">{formatDate(user.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" onClick={() => setResettingUser(user)} title="Reset password">
                        <Key className="size-4 text-amber-300" />
                      </ActionButton>
                      <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingUser(user)} title="Edit">
                        <Edit className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton
                        type="button"
                        variant="danger"
                        size="icon"
                        onClick={() => handleDelete(user.id, user.username)}
                        disabled={(isPending && deletingId === user.id) || user.id === currentUserId}
                        title={user.id === currentUserId ? "Cannot delete your own account" : "Delete"}
                      >
                        <Trash2 className="size-4" />
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </DataTableBody>
        </DataTable>
      </DataTableFrame>

      {editingUser && <EditUserForm user={editingUser} sites={sites} onClose={() => setEditingUser(null)} />}
      {resettingUser && <ResetPasswordModal user={resettingUser} onClose={() => setResettingUser(null)} />}
    </div>
  );
}

function SortableHead({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <th className="px-5 py-3 text-left">
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5">
        {label}
        {icon}
      </button>
    </th>
  );
}
