"use client";

import { updateRack } from "@/actions/rack-management";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Server } from "lucide-react";

type Rack = {
    id: number;
    name: string;
    zone: string | null;
    totalU: number | null;
    locationId: number | null;
    locationName: string | null;
};

type Location = {
    id: number;
    name: string;
};

interface EditRackFormProps {
    rack: Rack;
    onClose: () => void;
    locations: Location[];
}

export default function EditRackForm({ rack, onClose, locations }: EditRackFormProps) {
    const [state, action, isPending] = useActionState(updateRack, undefined);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, onClose, router]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-card-dark rounded-lg shadow-xl max-w-2xl w-full">
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <Server className="h-5 w-5 text-primary" />
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Edit Rack</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <form action={action} className="p-6">
                    <input type="hidden" name="id" value={rack.id} />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Rack Name *
                            </label>
                            <input
                                name="name"
                                defaultValue={rack.name}
                                required
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Zone
                            </label>
                            <input
                                name="zone"
                                defaultValue={rack.zone || ""}
                                placeholder="e.g. Zone A"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Total U
                            </label>
                            <select
                                name="totalU"
                                defaultValue={rack.totalU || 42}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="42">42U (Standard)</option>
                                <option value="45">45U</option>
                                <option value="47">47U</option>
                                <option value="48">48U</option>
                                <option value="30">30U</option>
                                <option value="24">24U</option>
                                <option value="12">12U</option>
                            </select>
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Location
                            </label>
                            <select
                                name="locationId"
                                defaultValue={rack.locationId?.toString() || ""}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">-- No Location --</option>
                                {locations.map(loc => (
                                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {state?.errors && (
                        <div className="mt-3 text-red-500 text-sm">
                            {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                                <p key={i}>{e}</p>
                            ))}
                        </div>
                    )}
                    {state?.message && !state.success && (
                        <div className="mt-3 text-red-500 text-sm">{state.message}</div>
                    )}

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isPending && <Loader2 className="animate-spin h-4 w-4" />}
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
