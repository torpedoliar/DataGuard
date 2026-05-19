"use client";

import { deleteRack } from "@/actions/rack-management";
import ActionButton from "@/components/ui/action-button";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { Edit, Server, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Rack = {
  id: number;
  name: string;
  zone: string | null;
  totalU: number | null;
  locationId: number | null;
  locationName: string | null;
  deviceCount?: number;
};

interface RackTableProps {
  racks: Rack[];
  onEdit: (rack: Rack) => void;
}

export default function RackTable({ racks, onEdit }: RackTableProps) {
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const router = useRouter();

  const handleDelete = (id: number, name: string) => {
    if (confirm(`Are you sure you want to delete rack "${name}"?`)) {
      setDeletingId(id);
      startTransition(async () => {
        await deleteRack(id);
        setDeletingId(null);
        router.refresh();
      });
    }
  };

  return (
    <DataTableFrame>
      <DataTable>
        <DataTableHead>
          <tr>
            <th className="px-5 py-3 text-left">Rack Name</th>
            <th className="px-5 py-3 text-left">Zone</th>
            <th className="px-5 py-3 text-left">Capacity</th>
            <th className="px-5 py-3 text-left">Location</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {racks.length === 0 ? (
            <DataTableEmpty colSpan={5} title="No racks defined" description="Add a rack above to start placing devices." />
          ) : (
            racks.map((rack) => (
              <tr key={rack.id} className="transition-colors hover:bg-ops-surface">
                <td className="whitespace-nowrap px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-md bg-ops-accent/12 text-[#b7f5e4]">
                      <Server className="size-4" />
                    </div>
                    <span className="text-sm font-semibold text-ops-text">{rack.name}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-ops-muted">{rack.zone || "-"}</td>
                <td className="whitespace-nowrap px-5 py-3">
                  <StatusBadge tone="info">{rack.totalU || 42}U</StatusBadge>
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-ops-muted">{rack.locationName || "-"}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <ActionButton type="button" variant="ghost" size="icon" onClick={() => onEdit(rack)} title="Edit rack">
                      <Edit className="size-4 text-blue-300" />
                    </ActionButton>
                    <ActionButton
                      type="button"
                      variant="danger"
                      size="icon"
                      onClick={() => handleDelete(rack.id, rack.name)}
                      disabled={isPending && deletingId === rack.id}
                      title="Delete rack"
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
  );
}
