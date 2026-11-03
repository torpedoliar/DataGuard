"use client";

import { addRack } from "@/actions/rack-management";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ActionButton from "@/components/ui/action-button";
import { Plus, Server } from "lucide-react";

const fieldClass = "ops-input h-9 w-full px-3 text-sm";

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
        <div className="ops-panel p-6">
            <div className="mb-4 flex items-center gap-2">
                <Server className="size-4 text-ops-accent" />
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Add new rack</h3>
            </div>

            <form ref={formRef} action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2">
                    <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                        Rack Name *
                    </label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Rack A-01"
                        className={fieldClass}
                    />
                </div>

                <div>
                    <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                        Zone
                    </label>
                    <input
                        name="zone"
                        placeholder="e.g. Zone A"
                        className={fieldClass}
                    />
                </div>

                <div>
                    <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                        Total U
                    </label>
                    <select
                        name="totalU"
                        defaultValue="42"
                        onChange={(event) => setCustomU(event.target.value === "custom")}
                        className={fieldClass}
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
                            className={`${fieldClass} mt-2`}
                        />
                    )}
                </div>

                <div>
                    <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                        Location
                    </label>
                    <select
                        name="locationId"
                        className={fieldClass}
                    >
                        <option value="">-- No Location --</option>
                        {locations.map(loc => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-5 grid grid-cols-3 gap-4">
                    <div>
                        <label className="mb-1 block text-[13px] font-medium text-ops-muted">Floor Row</label>
                        <input
                            name="floorRow"
                            maxLength={4}
                            placeholder="A"
                            className={fieldClass}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-[13px] font-medium text-ops-muted">Slot</label>
                        <input
                            type="number"
                            name="floorSlot"
                            min={1}
                            max={99}
                            placeholder="1"
                            className={fieldClass}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-[13px] font-medium text-ops-muted">Facing</label>
                        <select
                            name="facing"
                            defaultValue="front"
                            className={fieldClass}
                        >
                            <option value="front">Front</option>
                            <option value="back">Back</option>
                        </select>
                    </div>
                    <p className="col-span-3 text-xs text-ops-muted">
                        Posisi fisik di ruangan untuk tampilan 3D (baris, urutan, arah pintu depan). Kosongkan jika belum diketahui.
                    </p>
                </div>

                <div className="lg:col-span-5 flex items-center gap-2">
                    <fieldset className="flex items-center gap-2">
                        <input type="hidden" name="isAuditable" value="false" />
                        <input type="checkbox" name="isAuditable" defaultChecked value="on" />
                        <label className="text-[13px] font-medium text-ops-muted">Include in audit</label>
                    </fieldset>
                    <div className="flex-1"></div>
                    <ActionButton type="submit" isPending={isPending} icon={<Plus className="size-4" />}>
                        Add rack
                    </ActionButton>
                </div>
            </form>

            {state?.errors && (
                <div className="mt-3 text-[13px] text-ops-danger">
                    {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-[13px] text-ops-danger">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-[13px] text-ops-success">{state.message}</div>
            )}
        </div>
    );
}
