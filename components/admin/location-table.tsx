"use client";

import { deleteLocation } from "@/actions/locations";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Edit2, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import EditLocationModal from "./edit-location-modal";

type Location = {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date | null;
};

type SortKey = "name" | "description" | "createdAt";
type SortDir = "asc" | "desc";

const fieldClass = "ops-input h-9 px-3 text-sm";

export default function LocationTable({ locations }: { locations: Location[] }) {
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const router = useRouter();

  const handleDelete = (id: number) => {
    if (!confirm("Are you sure you want to delete this location?")) return;
    setErrorMsg(null);
    setDeletingId(id);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("id", id.toString());
      const result = await deleteLocation(formData);
      if (result.success) router.refresh();
      else setErrorMsg(result.message);
      setDeletingId(null);
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
    let data = locations;
    if (search.trim()) {
      const query = search.toLowerCase();
      data = data.filter((location) =>
        location.name.toLowerCase().includes(query) ||
        (location.description || "").toLowerCase().includes(query),
      );
    }
    data = [...data].sort((a, b) => {
      let compare = 0;
      if (sortKey === "name") compare = a.name.localeCompare(b.name);
      else if (sortKey === "description") compare = (a.description || "").localeCompare(b.description || "");
      else compare = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
      return sortDir === "asc" ? compare : -compare;
    });
    return data;
  }, [locations, search, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">
          <AlertCircle className="size-4" /> {errorMsg}
        </div>
      )}

      <DataToolbar>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search locations..." className={`${fieldClass} w-full pl-9 pr-8`} />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" title="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs font-medium text-ops-muted">{filtered.length} of {locations.length} Locations</span>
        </div>
      </DataToolbar>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <SortableHead label="Location Name" onClick={() => handleSort("name")} icon={renderSortIcon("name")} />
              <SortableHead label="Description" onClick={() => handleSort("description")} icon={renderSortIcon("description")} />
              <SortableHead label="Created At" onClick={() => handleSort("createdAt")} icon={renderSortIcon("createdAt")} />
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={4} title={search ? "No locations match your search" : "No locations found"} description="Add one location to start mapping devices to rooms." />
            ) : (
              filtered.map((location) => (
                <tr key={location.id} className="transition-colors hover:bg-ops-surface">
                  <td className="px-5 py-3 font-semibold text-ops-text">{location.name}</td>
                  <td className="px-5 py-3 text-ops-muted">{location.description || "-"}</td>
                  <td className="px-5 py-3 text-ops-muted">{location.createdAt ? new Date(location.createdAt).toLocaleDateString("id-ID") : "-"}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingLocation(location)} title="Edit">
                        <Edit2 className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton
                        type="button"
                        variant="danger"
                        size="icon"
                        onClick={() => handleDelete(location.id)}
                        disabled={isPending && deletingId === location.id}
                        title="Delete"
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

      {editingLocation && <EditLocationModal location={editingLocation} onClose={() => setEditingLocation(null)} />}
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
