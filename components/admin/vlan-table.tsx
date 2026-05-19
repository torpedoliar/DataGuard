"use client";

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
import { ArrowDown, ArrowUp, ArrowUpDown, Edit, Search, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import DeleteVlanModal from "./delete-vlan-modal";
import EditVlanModal from "./edit-vlan-modal";

type Vlan = {
  id: number;
  vlanId: number;
  name: string;
  subnet: string | null;
  description: string | null;
};

type SortKey = "vlanId" | "name" | "subnet";
type SortDir = "asc" | "desc";

const fieldClass = "ops-input h-9 px-3 text-sm";

export default function VlanTable({ vlans }: { vlans: Vlan[] }) {
  const [editingVlan, setEditingVlan] = useState<Vlan | null>(null);
  const [deletingVlan, setDeletingVlan] = useState<Vlan | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vlanId");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
    let data = vlans;
    if (search.trim()) {
      const query = search.toLowerCase();
      data = data.filter((vlan) =>
        vlan.name.toLowerCase().includes(query) ||
        String(vlan.vlanId).includes(query) ||
        (vlan.subnet || "").toLowerCase().includes(query) ||
        (vlan.description || "").toLowerCase().includes(query),
      );
    }
    data = [...data].sort((a, b) => {
      let compare = 0;
      if (sortKey === "vlanId") compare = a.vlanId - b.vlanId;
      else if (sortKey === "name") compare = a.name.localeCompare(b.name);
      else compare = (a.subnet || "").localeCompare(b.subnet || "");
      return sortDir === "asc" ? compare : -compare;
    });
    return data;
  }, [vlans, search, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <DataToolbar>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search VLANs..." className={`${fieldClass} w-full pl-9 pr-8`} />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" title="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs font-medium text-ops-muted">{filtered.length} of {vlans.length} VLANs</span>
        </div>
      </DataToolbar>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <SortableHead label="VLAN ID" onClick={() => handleSort("vlanId")} icon={renderSortIcon("vlanId")} />
              <SortableHead label="Name" onClick={() => handleSort("name")} icon={renderSortIcon("name")} />
              <SortableHead label="Subnet" onClick={() => handleSort("subnet")} icon={renderSortIcon("subnet")} />
              <th className="px-5 py-3 text-left">Description</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={5} title={search ? "No VLANs match your search" : "No VLANs defined"} description="Create a VLAN from the form above." />
            ) : (
              filtered.map((vlan) => (
                <tr key={vlan.id} className="transition-colors hover:bg-ops-surface">
                  <td className="whitespace-nowrap px-5 py-3">
                    <StatusBadge tone="info">VLAN {vlan.vlanId}</StatusBadge>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 font-semibold text-ops-text">{vlan.name}</td>
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ops-muted">{vlan.subnet || "-"}</td>
                  <td className="max-w-[300px] truncate px-5 py-3 text-ops-muted">{vlan.description || "-"}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingVlan(vlan)} title="Edit">
                        <Edit className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton type="button" variant="danger" size="icon" onClick={() => setDeletingVlan(vlan)} title="Delete">
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

      {editingVlan && <EditVlanModal vlan={editingVlan} onClose={() => setEditingVlan(null)} />}
      {deletingVlan && <DeleteVlanModal vlan={deletingVlan} onClose={() => setDeletingVlan(null)} />}
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
