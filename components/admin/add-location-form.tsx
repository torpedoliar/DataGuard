"use client";

import { addLocation } from "@/actions/locations";
import { useActionState, useEffect, useRef } from "react";
import { Loader2, Plus, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AddLocationForm() {
    const [state, action, isPending] = useActionState(addLocation, undefined);
    const formRef = useRef<HTMLFormElement>(null);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            formRef.current?.reset();
            router.refresh();
        }
    }, [state?.success, router]);

    return (
        <div className="bg-ops-surface p-6 rounded-lg shadow-sm border border-ops-border">
            <div className="flex items-center gap-2 mb-4">
                <MapPin className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-ops-text">Add New Location</h3>
            </div>

            <form ref={formRef} action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Location Name *
                    </label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Server Room A, Lt 2"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Description
                    </label>
                    <input
                        name="description"
                        placeholder="Optional description"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Batas Suhu (°C)
                    </label>
                    <input
                        name="tempThresholdC"
                        type="number"
                        step="0.5"
                        min={10}
                        max={60}
                        defaultValue={27}
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="flex items-center gap-2 text-sm text-ops-muted cursor-pointer py-2">
                        <input type="checkbox" name="excludeTempCheck" className="size-4 rounded border-ops-border-strong" />
                        Kecualikan dari audit suhu
                    </label>
                </div>

                <button
                    type="submit"
                    disabled={isPending}
                    className="bg-ops-accent text-ops-accent-fg px-4 py-2 rounded-md hover:bg-ops-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ops-accent flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    Add Location
                </button>
            </form>

            {state?.message && !state.success && (
                <div className="mt-3 text-ops-danger text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-ops-success text-sm">
                    {state.message}
                </div>
            )}
        </div>
    );
}
