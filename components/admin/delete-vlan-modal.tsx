"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteVlan } from "@/actions/network";
import { AlertTriangle, Loader2, X } from "lucide-react";

export default function DeleteVlanModal({ vlan, onClose }: { vlan: { id: number; vlanId: number; name: string }; onClose: () => void }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleDelete = () => {
        startTransition(async () => {
            await deleteVlan(vlan.id);
            router.refresh();
            onClose();
        });
    };

    return (
        <div className="fixed inset-0 bg-ops-surface/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-ops-surface rounded-xl max-w-sm w-full shadow-xl">
                <div className="flex items-center justify-between p-4 border-b border-ops-border">
                    <h2 className="text-lg font-semibold text-ops-text flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-ops-danger" />
                        Delete VLAN
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-ops-muted hover:text-ops-subtle dark:hover:text-ops-muted transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-sm text-ops-muted">
                        Are you sure you want to delete VLAN <span className="font-semibold text-ops-text">{vlan.vlanId} - {vlan.name}</span>?
                        This action cannot be undone, and any network ports using this VLAN might lose their association.
                    </p>

                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isPending}
                            className="px-4 py-2 text-ops-muted bg-ops-surface-raised hover:bg-ops-surface-raised dark:text-ops-muted dark:bg-ops-surface-raised dark:hover:bg-ops-surface-sunken rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-ops-danger text-ops-status-fg hover:bg-ops-danger rounded-lg transition-colors disabled:opacity-50"
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
