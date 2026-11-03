"use client";

import { addLocation } from "@/actions/locations";
import ActionButton from "@/components/ui/action-button";
import { useActionState, useEffect, useRef } from "react";
import { Plus, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";

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
        <div className="ops-panel p-5">
            <div className="mb-4 flex items-center gap-2">
                <MapPin aria-hidden="true" className="size-4 text-ops-accent" />
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Add new location</h2>
            </div>

            <form ref={formRef} action={action} className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 lg:grid-cols-5">
                <div className="lg:col-span-1">
                    <label htmlFor="location-name" className={labelClass}>
                        Location Name *
                    </label>
                    <input
                        id="location-name"
                        name="name"
                        required
                        placeholder="e.g. Server Room A, Lt 2"
                        className="ops-input h-9 w-full px-3 text-sm"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label htmlFor="location-description" className={labelClass}>
                        Description
                    </label>
                    <input
                        id="location-description"
                        name="description"
                        placeholder="Optional description"
                        className="ops-input h-9 w-full px-3 text-sm"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label htmlFor="location-temp" className={labelClass}>
                        Batas Suhu (°C)
                    </label>
                    <input
                        id="location-temp"
                        name="tempThresholdC"
                        type="number"
                        step="0.5"
                        min={10}
                        max={60}
                        defaultValue={27}
                        className="ops-input h-9 w-full px-3 text-sm tabular-nums"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="flex cursor-pointer items-center gap-2 py-2 text-sm text-ops-muted">
                        <input type="checkbox" name="excludeTempCheck" className="size-4 rounded border-ops-border-strong" />
                        Kecualikan dari audit suhu
                    </label>
                </div>

                <ActionButton
                    type="submit"
                    isPending={isPending}
                    icon={<Plus aria-hidden="true" className="size-4" />}
                    className="w-full"
                >
                    {isPending ? null : "Add Location"}
                </ActionButton>
            </form>

            {state?.message && !state.success && (
                <div className="mt-3 text-sm text-ops-danger">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-sm text-ops-success">
                    {state.message}
                </div>
            )}
        </div>
    );
}
