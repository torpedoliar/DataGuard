"use client";

import { deleteCategory, editCategory } from "@/actions/master-data";
import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Tag, Edit, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import EditCategoryModal from "./edit-category-modal";

type Category = {
    id: number;
    name: string;
    color: string | null;
};

export default function CategoryTable({ categories }: { categories: Category[] }) {
    const [isPending, startTransition] = useTransition();
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

    const handleDelete = (id: number, name: string) => {
        if (confirm(`Are you sure you want to delete category "${name}"? This action cannot be undone.`)) {
            setDeletingId(id);
            startTransition(async () => {
                const result = await deleteCategory(id);
                setDeletingId(null);
                if (result?.success) {
                    router.refresh();
                } else {
                    if (result?.usageCount) {
                        const deviceList = result.devices?.slice(0, 5).join(", ") || "";
                        const moreText = result.devices && result.devices.length > 5
                            ? `\n... and ${result.devices.length - 5} more devices.`
                            : "";
                        alert(
                            `Cannot delete "${name}"!\n\n` +
                            `This category is used by ${result.usageCount} device(s):\n${deviceList}${moreText}\n\n` +
                            `Please reassign or delete these devices first.`
                        );
                    } else {
                        alert(result?.message || "Failed to delete category");
                    }
                }
            });
        }
    };

    const filtered = useMemo(() => {
        let data = categories;
        if (search.trim()) {
            const q = search.toLowerCase();
            data = data.filter(c => c.name.toLowerCase().includes(q));
        }
        data = [...data].sort((a, b) => {
            const cmp = a.name.localeCompare(b.name);
            return sortDir === "asc" ? cmp : -cmp;
        });
        return data;
    }, [categories, search, sortDir]);

    return (
        <div className="glow-card overflow-hidden relative">
            {editingCategory && (
                <EditCategoryModal
                    category={editingCategory}
                    onClose={() => setEditingCategory(null)}
                    editAction={editCategory}
                />
            )}

            {/* Toolbar */}
            <div className="p-4 border-b border-slate-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search categories..."
                        className="w-full h-9 pl-9 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <span className="text-xs text-slate-500 font-medium">{filtered.length} of {categories.length} Categories</span>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                            <th className="px-5 py-3 text-left cursor-pointer select-none" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>
                                <span className="inline-flex items-center gap-1.5">
                                    Category Name
                                    {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-blue-400" /> : <ArrowDown className="h-3.5 w-3.5 text-blue-400" />}
                                </span>
                            </th>
                            <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={2} className="px-5 py-8 text-center text-slate-500">
                                    {search ? "No categories match your search." : "No categories defined. Add one above."}
                                </td>
                            </tr>
                        ) : (
                            filtered.map((category) => (
                                <tr key={category.id} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-5 py-3 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="size-8 rounded-lg flex items-center justify-center text-white shadow-sm"
                                                style={{ backgroundColor: category.color || '#3b82f6' }}
                                            >
                                                <Tag className="h-4 w-4" />
                                            </div>
                                            <span className="font-medium text-white">{category.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 whitespace-nowrap text-right">
                                        <div className="inline-flex items-center gap-1">
                                            <button onClick={() => setEditingCategory(category)} className="p-1.5 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(category.id, category.name)}
                                                disabled={isPending && deletingId === category.id}
                                                className="p-1.5 rounded-lg hover:bg-slate-700 text-red-400 transition-colors disabled:opacity-50"
                                                title="Delete"
                                            >
                                                {isPending && deletingId === category.id
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
        </div>
    );
}
