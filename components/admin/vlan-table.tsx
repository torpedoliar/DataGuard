"use client";

import { Edit, Trash2, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { useState, useMemo } from "react";
import EditVlanModal from "./edit-vlan-modal";
import DeleteVlanModal from "./delete-vlan-modal";

type Vlan = {
    id: number;
    vlanId: number;
    name: string;
    subnet: string | null;
    description: string | null;
};

type SortKey = "vlanId" | "name" | "subnet";
type SortDir = "asc" | "desc";

export default function VlanTable({ vlans }: { vlans: Vlan[] }) {
    const [editingVlan, setEditingVlan] = useState<Vlan | null>(null);
    const [deletingVlan, setDeletingVlan] = useState<Vlan | null>(null);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("vlanId");
    const [sortDir, setSortDir] = useState<SortDir>("asc");

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-600" />;
        return sortDir === "asc"
            ? <ArrowUp className="h-3.5 w-3.5 text-blue-400" />
            : <ArrowDown className="h-3.5 w-3.5 text-blue-400" />;
    };

    const filtered = useMemo(() => {
        let data = vlans;
        if (search.trim()) {
            const q = search.toLowerCase();
            data = data.filter(v =>
                v.name.toLowerCase().includes(q) ||
                String(v.vlanId).includes(q) ||
                (v.subnet || "").toLowerCase().includes(q) ||
                (v.description || "").toLowerCase().includes(q)
            );
        }
        data = [...data].sort((a, b) => {
            let cmp = 0;
            if (sortKey === "vlanId") cmp = a.vlanId - b.vlanId;
            else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
            else if (sortKey === "subnet") cmp = (a.subnet || "").localeCompare(b.subnet || "");
            return sortDir === "asc" ? cmp : -cmp;
        });
        return data;
    }, [vlans, search, sortKey, sortDir]);

    return (
        <div className="glow-card overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search VLANs..."
                        className="w-full h-9 pl-9 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <span className="text-xs text-slate-500 font-medium">{filtered.length} of {vlans.length} VLANs</span>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("vlanId")}>
                                <span className="inline-flex items-center gap-1.5">VLAN ID <SortIcon col="vlanId" /></span>
                            </th>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("name")}>
                                <span className="inline-flex items-center gap-1.5">Name <SortIcon col="name" /></span>
                            </th>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("subnet")}>
                                <span className="inline-flex items-center gap-1.5">Subnet <SortIcon col="subnet" /></span>
                            </th>
                            <th className="px-5 py-3 text-left">Description</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                                    {search ? "No VLANs match your search." : "No VLANs defined. Create one using the form above."}
                                </td>
                            </tr>
                        ) : (
                            filtered.map((vlan) => (
                                <tr key={vlan.id} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-5 py-3 whitespace-nowrap">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                            VLAN {vlan.vlanId}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 whitespace-nowrap font-medium text-white">{vlan.name}</td>
                                    <td className="px-5 py-3 whitespace-nowrap text-slate-400 font-mono text-xs">{vlan.subnet || "-"}</td>
                                    <td className="px-5 py-3 text-slate-400 max-w-[300px] truncate">{vlan.description || "-"}</td>
                                    <td className="px-5 py-3 whitespace-nowrap text-right">
                                        <div className="inline-flex items-center gap-1">
                                            <button onClick={() => setEditingVlan(vlan)} className="p-1.5 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => setDeletingVlan(vlan)} className="p-1.5 rounded-lg hover:bg-slate-700 text-red-400 transition-colors" title="Delete">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {editingVlan && <EditVlanModal vlan={editingVlan} onClose={() => setEditingVlan(null)} />}
            {deletingVlan && <DeleteVlanModal vlan={deletingVlan} onClose={() => setDeletingVlan(null)} />}
        </div>
    );
}
