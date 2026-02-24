"use client";

import { Trash2, Edit, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import EditBrandForm from "./edit-brand-form";
import DeleteBrandModal from "./delete-brand-modal";

type Brand = {
    id: number;
    name: string;
    logoPath: string | null;
    createdAt: Date | null;
};

type SortKey = "name" | "createdAt";
type SortDir = "asc" | "desc";

export default function BrandTable({ brands }: { brands: Brand[] }) {
    const [, startTransition] = useTransition();
    const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
    const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null);
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("name");
    const [sortDir, setSortDir] = useState<SortDir>("asc");

    const handleDeleteSuccess = () => {
        setDeletingBrand(null);
        startTransition(() => { router.refresh(); });
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
        let data = brands;
        if (search.trim()) {
            const q = search.toLowerCase();
            data = data.filter(b => b.name.toLowerCase().includes(q));
        }
        data = [...data].sort((a, b) => {
            let cmp = 0;
            if (sortKey === "name") cmp = a.name.localeCompare(b.name);
            else if (sortKey === "createdAt") cmp = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
            return sortDir === "asc" ? cmp : -cmp;
        });
        return data;
    }, [brands, search, sortKey, sortDir]);

    return (
        <div className="overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search brands..."
                        className="w-full h-9 pl-9 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <span className="text-xs text-slate-500 font-medium">{filtered.length} of {brands.length} Brands</span>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => handleSort("name")}>
                                <span className="inline-flex items-center gap-1.5">Brand Name <SortIcon col="name" /></span>
                            </th>
                            <th className="px-5 py-3 text-left">Logo</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={3} className="px-5 py-8 text-center text-slate-500">
                                    {search ? "No brands match your search." : "No brands defined yet. Create one to the left."}
                                </td>
                            </tr>
                        ) : (
                            filtered.map((brand) => (
                                <tr key={brand.id} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-5 py-3 whitespace-nowrap font-medium text-white">{brand.name}</td>
                                    <td className="px-5 py-3 whitespace-nowrap">
                                        {brand.logoPath ? (
                                            <div className="h-8 w-20 bg-white rounded p-1 border border-slate-600 flex items-center justify-center overflow-hidden">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={brand.logoPath} alt={brand.name} className="max-h-full max-w-full object-contain" />
                                            </div>
                                        ) : (
                                            <span className="text-slate-500 italic text-xs">No Logo</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 whitespace-nowrap text-right">
                                        <div className="inline-flex items-center gap-1">
                                            <button onClick={() => setEditingBrand(brand)} className="p-1.5 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => setDeletingBrand(brand)} className="p-1.5 rounded-lg hover:bg-slate-700 text-red-400 transition-colors" title="Delete">
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

            {editingBrand && <EditBrandForm brand={editingBrand} onClose={() => setEditingBrand(null)} />}
            {deletingBrand && <DeleteBrandModal brandId={deletingBrand.id} brandName={deletingBrand.name} onClose={() => setDeletingBrand(null)} onSuccess={handleDeleteSuccess} />}
        </div>
    );
}
