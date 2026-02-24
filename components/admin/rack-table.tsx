"use client";

import { deleteRack } from "@/actions/rack-management";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Edit, Server } from "lucide-react";

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
        <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Rack Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Zone
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Capacity
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Location
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-card-dark divide-y divide-slate-200 dark:divide-slate-700">
                        {racks.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                    No racks defined. Add one above.
                                </td>
                            </tr>
                        ) : (
                            racks.map((rack) => (
                                <tr key={rack.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                                <Server className="h-5 w-5" />
                                            </div>
                                            <span className="text-sm font-medium text-slate-900 dark:text-white">
                                                {rack.name}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                                        {rack.zone || "-"}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-500/10 dark:text-blue-400">
                                            {rack.totalU || 42}U
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                                        {rack.locationName || "-"}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => onEdit(rack)}
                                                className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 focus:outline-none"
                                                title="Edit rack"
                                            >
                                                <Edit className="h-5 w-5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(rack.id, rack.name)}
                                                disabled={isPending && deletingId === rack.id}
                                                className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 focus:outline-none disabled:opacity-50"
                                                title="Delete rack"
                                            >
                                                {isPending && deletingId === rack.id ? (
                                                    <span className="text-xs">...</span>
                                                ) : (
                                                    <Trash2 className="h-5 w-5" />
                                                )}
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
