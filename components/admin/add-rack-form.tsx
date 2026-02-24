"use client";

import { addRack } from "@/actions/rack-management";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Server } from "lucide-react";

type Location = {
    id: number;
    name: string;
};

export default function AddRackForm({ locations }: { locations: Location[] }) {
    const [state, action, isPending] = useActionState(addRack, undefined);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            router.refresh();
        }
    }, [state?.success, router]);

    return (
        <div className="bg-white dark:bg-card-dark p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-8">
            <div className="flex items-center gap-2 mb-4">
                <Server className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add New Rack</h3>
            </div>

            <form action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Rack Name *
                    </label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Rack A-01"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Zone
                    </label>
                    <input
                        name="zone"
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
                        defaultValue="42"
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

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Location
                    </label>
                    <select
                        name="locationId"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">-- No Location --</option>
                        {locations.map(loc => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-5 flex justify-end">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="h-5 w-5" /> Add Rack</>}
                    </button>
                </div>
            </form>

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
            {state?.success && (
                <div className="mt-3 text-green-600 dark:text-green-400 text-sm">{state.message}</div>
            )}
        </div>
    );
}
