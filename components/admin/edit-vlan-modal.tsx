"use client";

import { useState, useTransition } from "react";
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
                onClose();
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to update VLAN.");
            }
        });
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-xl max-w-md w-full shadow-xl">
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-white">
                        Edit VLAN {vlan.vlanId}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                VLAN ID
                                <span className="text-xs text-slate-500 font-normal">(Immutable)</span>
                            </label>
                            <input
                                type="text"
                                value={vlan.vlanId}
                                disabled
                                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-100 dark:bg-slate-700/50 text-slate-500 cursor-not-allowed"
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                Name *
                            </label>
                            <input
                                type="text"
                                id="edit_name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white"
                                required
                                disabled={isPending}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_subnet" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                Subnet
                            </label>
                            <input
                                type="text"
                                id="edit_subnet"
                                value={subnet}
                                onChange={(e) => setSubnet(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white"
                                disabled={isPending}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit_description" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                Description
                            </label>
                            <textarea
                                id="edit_description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white custom-scrollbar"
                                disabled={isPending}
                            />
                        </div>
                    </div>

                    {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

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
                            type="submit"
                            disabled={isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
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
