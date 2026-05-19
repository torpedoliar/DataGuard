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
import { ArrowDown, ArrowUp, ArrowUpDown, Edit, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import DeleteBrandModal from "./delete-brand-modal";
import EditBrandForm from "./edit-brand-form";

type Brand = {
  id: number;
  name: string;
  logoPath: string | null;
  createdAt: Date | null;
};

type SortKey = "name" | "createdAt";
type SortDir = "asc" | "desc";

const fieldClass = "ops-input h-9 px-3 text-sm";

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
    if (sortKey === key) setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (column: SortKey) => {
    if (sortKey !== column) return <ArrowUpDown className="size-3.5 text-slate-600" />;
    return sortDir === "asc"
      ? <ArrowUp className="size-3.5 text-ops-accent" />
      : <ArrowDown className="size-3.5 text-ops-accent" />;
  };

  const filtered = useMemo(() => {
    let data = brands;
    if (search.trim()) {
      const query = search.toLowerCase();
      data = data.filter((brand) => brand.name.toLowerCase().includes(query));
    }
    data = [...data].sort((a, b) => {
      const compare = sortKey === "name"
        ? a.name.localeCompare(b.name)
        : (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
      return sortDir === "asc" ? compare : -compare;
    });
    return data;
  }, [brands, search, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <DataToolbar>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search brands..."
              className={`${fieldClass} w-full pl-9 pr-8`}
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text" title="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs font-medium text-ops-muted">{filtered.length} of {brands.length} Brands</span>
        </div>
      </DataToolbar>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <th className="px-5 py-3 text-left">
                <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1.5">
                  Brand Name {renderSortIcon("name")}
                </button>
              </th>
              <th className="px-5 py-3 text-left">Logo</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={3} title={search ? "No brands match your search" : "No brands defined yet"} description="Create a brand from the form on this page." />
            ) : (
              filtered.map((brand) => (
                <tr key={brand.id} className="transition-colors hover:bg-ops-surface">
                  <td className="whitespace-nowrap px-5 py-3 font-semibold text-ops-text">{brand.name}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    {brand.logoPath ? (
                      <div className="flex h-8 w-20 items-center justify-center overflow-hidden rounded-md border border-ops-border bg-white p-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={brand.logoPath} alt={brand.name} className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <span className="text-xs italic text-ops-muted">No logo</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingBrand(brand)} title="Edit">
                        <Edit className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton type="button" variant="danger" size="icon" onClick={() => setDeletingBrand(brand)} title="Delete">
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

      {editingBrand && <EditBrandForm brand={editingBrand} onClose={() => setEditingBrand(null)} />}
      {deletingBrand && <DeleteBrandModal brandId={deletingBrand.id} brandName={deletingBrand.name} onClose={() => setDeletingBrand(null)} onSuccess={handleDeleteSuccess} />}
    </div>
  );
}
