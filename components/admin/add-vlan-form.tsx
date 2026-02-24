"use client";

import { useState, useTransition } from "react";
import { addVlan } from "@/actions/network";
import { Plus, Loader2 } from "lucide-react";

export default function AddVlanForm() {
    const [isPending, startTransition] = useTransition();
    const [vlanId, setVlanId] = useState("");
    const [name, setName] = useState("");
    const [subnet, setSubnet] = useState("");
    const [description, setDescription] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!vlanId || !name) {
            setError("VLAN ID and Name are required.");
            return;
        }

        const vlanNumber = parseInt(vlanId);
        if (isNaN(vlanNumber) || vlanNumber < 1 || vlanNumber > 4094) {
            setError("VLAN ID must be between 1 and 4094.");
            return;
        }

        startTransition(async () => {
            try {
                await addVlan({
                    vlanId: vlanNumber,
                    name,
                    subnet: subnet || undefined,
                    description: description || undefined
                });
                setSuccess("VLAN added successfully!");
                setVlanId("");
                setName("");
                setSubnet("");
                setDescription("");
                setTimeout(() => setSuccess(null), 3000);
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to add VLAN.");
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                Add New VLAN
            </h3>

            <div className="grid gap-6 md:grid-cols-4">
                <div>
                    <label htmlFor="vlanId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        VLAN ID *
                    </label>
                    <input
                        type="number"
                        id="vlanId"
                        value={vlanId}
                        onChange={(e) => setVlanId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white"
                        placeholder="10"
                        min="1"
                        max="4094"
                        required
                        disabled={isPending}
                    />
                </div>
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        VLAN Name *
                    </label>
                    <input
                        type="text"
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white"
                        placeholder="Management"
                        required
                        disabled={isPending}
                    />
                </div>
                <div>
                    <label htmlFor="subnet" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Subnet (Optional)
                    </label>
                    <input
                        type="text"
                        id="subnet"
                        value={subnet}
                        onChange={(e) => setSubnet(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white"
                        placeholder="192.168.10.0/24"
                        disabled={isPending}
                    />
                </div>
                <div>
                    <label htmlFor="description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Description (Optional)
                    </label>
                    <input
                        type="text"
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white"
                        placeholder="Core servers network"
                        disabled={isPending}
                    />
                </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            {success && <p className="mt-4 text-sm text-green-500">{success}</p>}

            <div className="mt-6 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-md hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    Add VLAN
                </button>
            </div>
        </form>
    );
}
