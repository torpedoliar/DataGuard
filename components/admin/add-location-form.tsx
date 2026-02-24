"use client";

import { addLocation } from "@/actions/locations";
import { useActionState, useEffect, useRef } from "react";
import { Loader2, Plus, MapPin } from "lucide-react";

export default function AddLocationForm() {
    const [state, action, isPending] = useActionState(addLocation, undefined);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (state?.success) {
            formRef.current?.reset();
        }
    }, [state?.success]);

    return (
        <div className="bg-white dark:bg-card-dark p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-4">
                <MapPin className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add New Location</h3>
            </div>

            <form ref={formRef} action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Location Name *
                    </label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Server Room A, Lt 2"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Description
                    </label>
                    <input
                        name="description"
                        placeholder="Optional description"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <button
                    type="submit"
                    disabled={isPending}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    Add Location
                </button>
            </form>

            {state?.message && !state.success && (
                <div className="mt-3 text-red-500 text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-green-600 dark:text-green-400 text-sm">
                    {state.message}
                </div>
            )}
        </div>
    );
}
