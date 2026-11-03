"use client";

import { addRack } from "@/actions/rack-management";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Server } from "lucide-react";

type Location = {
    id: number;
    name: string;
};

export default function AddRackForm({
    locations,
    onSuccess,
}: {
    locations: Location[];
    onSuccess?: () => void;
}) {
    const [state, action, isPending] = useActionState(addRack, undefined);
    const formRef = useRef<HTMLFormElement>(null);
    const router = useRouter();
    const [customU, setCustomU] = useState(false);
    // Guard against repeat runs: `state` stays { success: true } after a
    // submit, so a boolean dep would skip every consecutive success (stale
    // form + stale list until a manual refresh). Track the handled result
    // object instead — each dispatch produces a new one.
    const lastHandledRef = useRef<unknown>(null);

    useEffect(() => {
        if (state?.success && lastHandledRef.current !== state) {
            lastHandledRef.current = state;
            formRef.current?.reset();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot form reset after a successful submit, same pattern as edit-device-form
            setCustomU(false);
            router.refresh();
            onSuccess?.();
        }
    }, [state, router, onSuccess]);

    return (
        <div className="bg-ops-surface p-6 rounded-lg shadow-sm border border-ops-border mb-8">
            <div className="flex items-center gap-2 mb-4">
                <Server className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-ops-text">Add New Rack</h3>
            </div>

            <form ref={formRef} action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Rack Name *
                    </label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Rack A-01"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Zone
                    </label>
                    <input
                        name="zone"
                        placeholder="e.g. Zone A"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Total U
                    </label>
                    <select
                        name="totalU"
                        defaultValue="42"
                        onChange={(event) => setCustomU(event.target.value === "custom")}
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    >
                        <option value="42">42U (Standard)</option>
                        <option value="45">45U</option>
                        <option value="47">47U</option>
                        <option value="48">48U</option>
                        <option value="30">30U</option>
                        <option value="24">24U</option>
                        <option value="12">12U</option>
                        <option value="9">9U</option>
                        <option value="4">4U (Wall Mount)</option>
                        <option value="custom">Custom…</option>
                    </select>
                    {customU && (
                        <input
                            type="number"
                            name="totalU"
                            min={1}
                            max={60}
                            required
                            placeholder="Jumlah U (1-60)"
                            className="mt-2 w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        />
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Location
                    </label>
                    <select
                        name="locationId"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    >
                        <option value="">-- No Location --</option>
                        {locations.map(loc => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-5 grid grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-ops-muted mb-1">Floor Row</label>
                        <input
                            name="floorRow"
                            maxLength={4}
                            placeholder="A"
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ops-muted mb-1">Slot</label>
                        <input
                            type="number"
                            name="floorSlot"
                            min={1}
                            max={99}
                            placeholder="1"
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ops-muted mb-1">Facing</label>
                        <select
                            name="facing"
                            defaultValue="front"
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        >
                            <option value="front">Front</option>
                            <option value="back">Back</option>
                        </select>
                    </div>
                    <p className="col-span-3 text-xs text-ops-subtle">
                        Posisi fisik di ruangan untuk tampilan 3D (baris, urutan, arah pintu depan). Kosongkan jika belum diketahui.
                    </p>
                </div>

                <div className="lg:col-span-5 flex items-center gap-2">
                    <fieldset className="flex items-center gap-2">
                        <input type="hidden" name="isAuditable" value="false" />
                        <input type="checkbox" name="isAuditable" defaultChecked value="on" />
                        <label className="text-sm font-medium text-ops-muted">Include in audit</label>
                    </fieldset>
                    <div className="flex-1"></div>
                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-ops-accent text-ops-accent-fg px-6 py-2 rounded-md hover:bg-ops-accent-hover flex items-center gap-2 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="h-5 w-5" /> Add Rack</>}
                    </button>
                </div>
            </form>

            {state?.errors && (
                <div className="mt-3 text-ops-danger text-sm">
                    {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-ops-danger text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-ops-success text-sm">{state.message}</div>
            )}
        </div>
    );
}
