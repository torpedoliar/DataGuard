"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVlan } from "@/actions/network";
import { Loader2, X } from "lucide-react";

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
        <div className="fixed inset-0 bg-ops-surface/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-ops-surface rounded-xl max-w-md w-full shadow-xl">
                <div className="flex items-center justify-between p-6 border-b border-ops-border">
                    <h2 className="text-xl font-semibold text-ops-text">
                        Edit VLAN {vlan.vlanId}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-ops-muted hover:text-ops-subtle dark:hover:text-ops-muted transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-ops-muted flex items-center gap-2">
                                VLAN ID
                                <span className="text-xs text-ops-subtle font-normal">(Immutable)</span>
                            </label>
                            <input
                                type="text"
                                value={vlan.vlanId}
                                disabled
                                className="mt-1 w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface-raised/50 text-ops-subtle cursor-not-allowed"
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_name" className="block text-sm font-medium text-ops-muted">
                                Name *
                            </label>
                            <input
                                type="text"
                                id="edit_name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-ops-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-ops-surface-raised text-ops-text"
                                required
                                disabled={isPending}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_subnet" className="block text-sm font-medium text-ops-muted">
                                Subnet
                            </label>
                            <input
                                type="text"
                                id="edit_subnet"
                                value={subnet}
                                onChange={(e) => setSubnet(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-ops-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-ops-surface-raised text-ops-text"
                                disabled={isPending}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_description" className="block text-sm font-medium text-ops-muted">
                                Description
                            </label>
                            <textarea
                                id="edit_description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="mt-1 w-full px-3 py-2 border border-ops-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-ops-surface-raised text-ops-text custom-scrollbar"
                                disabled={isPending}
                            />
                        </div>
                    </div>

                    {error && <p className="mt-4 text-sm text-ops-danger">{error}</p>}

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
                            type="submit"
                            disabled={isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-ops-accent-fg hover:bg-ops-accent-hover rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
