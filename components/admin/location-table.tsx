"use client";

import { useState, useMemo, useTransition } from "react";
import { deleteLocation } from "@/actions/locations";
import { Edit2, Trash2, Loader2, AlertCircle, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import EditLocationModal from "./edit-location-modal";

type Location = {
    id: number;
    name: string;
    description: string | null;
    createdAt: Date | null;
};

type SortKey = "name" | "description" | "createdAt";
type SortDir = "asc" | "desc";

export default function LocationTable({ locations }: { locations: Location[] }) {
    const [editingLocation, setEditingLocation] = useState<Location | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("name");
    const [sortDir, setSortDir] = useState<SortDir>("asc");

    const handleDelete = (id: number) => {
        if (!confirm("Are you sure you want to delete this location?")) return;
        setErrorMsg(null);
        setDeletingId(id);
        startTransition(async () => {
            const formData = new FormData();
            formData.append("id", id.toString());
            const result = await deleteLocation(formData);
            if (!result.success) setErrorMsg(result.message);
            setDeletingId(null);
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
        let data = locations;
        if (search.trim()) {
            const q = search.toLowerCase();
            data = data.filter(l =>
                l.name.toLowerCase().includes(q) ||
                (l.description || "").toLowerCase().includes(q)
            );
        }
        data = [...data].sort((a, b) => {
            let cmp = 0;
            if (sortKey === "name") cmp = a.name.localeCompare(b.name);
            else if (sortKey === "description") cmp = (a.description || "").localeCompare(b.description || "");
            else if (sortKey === "createdAt") cmp = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
            return sortDir === "asc" ? cmp : -cmp;
        });
        return data;
    }, [locations, search, sortKey, sortDir]);

    return (
        <div className="glow-card overflow-hidden">
            {errorMsg && (
                <div className="p-3 bg-red-500/10 text-red-400 flex items-center gap-2 text-sm border-b border-red-500/20">
                    <AlertCircle className="h-4 w-4" /> {errorMsg}
                </div>
            )}

            {/* Toolbar */}
            <div className="p-4 border-b border-slate-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search locations..."
                        className="w-full h-9 pl-9 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <span className="text-xs text-slate-500 font-medium">{filtered.length} of {locations.length} Locations</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("name")}>
                                <span className="inline-flex items-center gap-1.5">Location Name <SortIcon col="name" /></span>
                            </th>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("description")}>
                                <span className="inline-flex items-center gap-1.5">Description <SortIcon col="description" /></span>
                            </th>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                                <span className="inline-flex items-center gap-1.5">Created At <SortIcon col="createdAt" /></span>
                            </th>
                            <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                                    {search ? "No locations match your search." : "No locations found. Add one to get started."}
                                </td>
                            </tr>
                        ) : (
                            filtered.map((loc) => (
                                <tr key={loc.id} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-5 py-3 font-medium text-white">{loc.name}</td>
                                    <td className="px-5 py-3 text-slate-400">{loc.description || "-"}</td>
                                    <td className="px-5 py-3 text-slate-400">{loc.createdAt ? new Date(loc.createdAt).toLocaleDateString("id-ID") : "-"}</td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="inline-flex items-center gap-1">
                                            <button onClick={() => setEditingLocation(loc)} className="p-1.5 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                <Edit2 className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => handleDelete(loc.id)} disabled={isPending && deletingId === loc.id} className="p-1.5 rounded-lg hover:bg-slate-700 text-red-400 transition-colors disabled:opacity-50" title="Delete">
                                                {isPending && deletingId === loc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {editingLocation && <EditLocationModal location={editingLocation} onClose={() => setEditingLocation(null)} />}
        </div>
    );
}
