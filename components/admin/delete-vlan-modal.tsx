"use client";

import { useTransition } from "react";
import { deleteVlan } from "@/actions/network";
import { AlertTriangle, Loader2, X } from "lucide-react";

export default function DeleteVlanModal({ vlan, onClose }: { vlan: { id: number; vlanId: number; name: string }; onClose: () => void }) {
    const [isPending, startTransition] = useTransition();

    const handleDelete = () => {
        startTransition(async () => {
            await deleteVlan(vlan.id);
            onClose();
        });
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-xl max-w-sm w-full shadow-xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        Delete VLAN
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Are you sure you want to delete VLAN <span className="font-semibold text-slate-900 dark:text-white">{vlan.vlanId} - {vlan.name}</span>?
                        This action cannot be undone, and any network ports using this VLAN might lose their association.
                    </p>

                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isPending}
                            className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            Delete Vlan
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
