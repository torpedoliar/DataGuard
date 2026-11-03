"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteVlan } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { AlertTriangle, X } from "lucide-react";

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-ops-border p-4">
                    <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                        <AlertTriangle className="size-4 text-ops-danger" />
                        Delete VLAN
                    </h2>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <div className="p-5">
                    <p className="text-[13px] text-ops-muted">
                        Are you sure you want to delete VLAN <span className="font-semibold text-ops-text">{vlan.vlanId} - {vlan.name}</span>?
                        This action cannot be undone, and any network ports using this VLAN might lose their association.
                    </p>

                    <div className="mt-6 flex justify-end gap-3">
                        <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                            Cancel
                        </ActionButton>
                        <ActionButton type="button" variant="danger" onClick={handleDelete} isPending={isPending}>
                            Delete VLAN
                        </ActionButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
