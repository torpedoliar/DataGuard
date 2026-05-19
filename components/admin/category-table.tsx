"use client";

import { deleteCategory, editCategory } from "@/actions/master-data";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import { ArrowDown, ArrowUp, Edit, Search, Tag, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import EditCategoryModal from "./edit-category-modal";

type Category = {
  id: number;
  name: string;
  color: string | null;
};

const fieldClass = "ops-input h-9 px-3 text-sm";

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
        } else if (result?.usageCount) {
          const deviceList = result.devices?.slice(0, 5).join(", ") || "";
          const moreText = result.devices && result.devices.length > 5
            ? `\n... and ${result.devices.length - 5} more devices.`
            : "";
          alert(
            `Cannot delete "${name}"!\n\n` +
            `This category is used by ${result.usageCount} device(s):\n${deviceList}${moreText}\n\n` +
            "Please reassign or delete these devices first.",
          );
        } else {
          alert(result?.message || "Failed to delete category");
        }
      });
    }
  };

  const filtered = useMemo(() => {
    let data = categories;
    if (search.trim()) {
      const query = search.toLowerCase();
      data = data.filter((category) => category.name.toLowerCase().includes(query));
    }
    data = [...data].sort((a, b) => {
      const compare = a.name.localeCompare(b.name);
      return sortDir === "asc" ? compare : -compare;
    });
    return data;
  }, [categories, search, sortDir]);

  return (
    <div className="space-y-3">
      {editingCategory && (
        <EditCategoryModal category={editingCategory} onClose={() => setEditingCategory(null)} editAction={editCategory} />
      )}

      <DataToolbar>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories..." className={`${fieldClass} w-full pl-9 pr-8`} />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" title="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs font-medium text-ops-muted">{filtered.length} of {categories.length} Categories</span>
        </div>
      </DataToolbar>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <th className="px-5 py-3 text-left">
                <button type="button" onClick={() => setSortDir((direction) => direction === "asc" ? "desc" : "asc")} className="inline-flex items-center gap-1.5">
                  Category Name
                  {sortDir === "asc" ? <ArrowUp className="size-3.5 text-ops-accent" /> : <ArrowDown className="size-3.5 text-ops-accent" />}
                </button>
              </th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={2} title={search ? "No categories match your search" : "No categories defined"} description="Add a category above to classify devices." />
            ) : (
              filtered.map((category) => (
                <tr key={category.id} className="transition-colors hover:bg-ops-surface">
                  <td className="whitespace-nowrap px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-md text-white" style={{ backgroundColor: category.color || "#5dd4b4" }}>
                        <Tag className="size-4" />
                      </div>
                      <span className="font-semibold text-ops-text">{category.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingCategory(category)} title="Edit">
                        <Edit className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton
                        type="button"
                        variant="danger"
                        size="icon"
                        onClick={() => handleDelete(category.id, category.name)}
                        disabled={isPending && deletingId === category.id}
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
    </div>
  );
}
