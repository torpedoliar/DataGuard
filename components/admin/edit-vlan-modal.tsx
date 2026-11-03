"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVlan } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { X } from "lucide-react";

const fieldClass = "ops-input h-9 w-full px-3 text-sm";

type Vlan = {
    id: number;
    vlanId: number;
    name: string;
    subnet: string | null;
    description: string | null;
};

export default function EditVlanModal({ vlan, onClose }: { vlan: Vlan; onClose: () => void }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [name, setName] = useState(vlan.name);
    const [subnet, setSubnet] = useState(vlan.subnet || "");
    const [description, setDescription] = useState(vlan.description || "");
    const [error, setError] = useState<string | null>(null);
    useModalDismiss(onClose, true, !isPending);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!name) {
            setError("VLAN Name is required.");
            return;
        }

        startTransition(async () => {
            try {
                await updateVlan(vlan.id, {
                    name,
                    subnet: subnet || undefined,
                    description: description || undefined
                });
                router.refresh();
                onClose();
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to update VLAN.");
            }
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-ops-border p-5">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                        Edit VLAN {vlan.vlanId}
                    </h2>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form onSubmit={handleSubmit} className="p-5">
                    <div className="space-y-4">
                        <div>
                            <label className="flex items-center gap-2 text-[13px] font-medium text-ops-muted">
                                VLAN ID
                                <span className="text-xs font-normal text-ops-subtle">(Immutable)</span>
                            </label>
                            <input
                                type="text"
                                value={vlan.vlanId}
                                disabled
                                className="mt-1 w-full cursor-not-allowed rounded-md border border-ops-border-strong bg-ops-surface-sunken px-3 py-2 text-sm text-ops-muted"
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_name" className="block text-[13px] font-medium text-ops-muted">
                                Name *
                            </label>
                            <input
                                type="text"
                                id="edit_name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className={`${fieldClass} mt-1`}
                                required
                                disabled={isPending}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_subnet" className="block text-[13px] font-medium text-ops-muted">
                                Subnet
                            </label>
                            <input
                                type="text"
                                id="edit_subnet"
                                value={subnet}
                                onChange={(e) => setSubnet(e.target.value)}
                                className={`${fieldClass} mt-1`}
                                disabled={isPending}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_description" className="block text-[13px] font-medium text-ops-muted">
                                Description
                            </label>
                            <textarea
                                id="edit_description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="ops-input mt-1 w-full px-3 py-2 text-sm custom-scrollbar"
                                disabled={isPending}
                            />
                        </div>
                    </div>

                    {error && <p className="mt-4 text-[13px] text-ops-danger">{error}</p>}

                    <div className="mt-6 flex justify-end gap-3">
                        <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                            Cancel
                        </ActionButton>
                        <ActionButton type="submit" isPending={isPending}>
                            Save changes
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
