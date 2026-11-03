"use client";

import { updateRack } from "@/actions/rack-management";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { X, Server } from "lucide-react";

const fieldClass = "ops-input h-9 w-full px-3 text-sm";

type Rack = {
    id: number;
    name: string;
    zone: string | null;
    totalU: number | null;
    locationId: number | null;
    locationName: string | null;
    isAuditable?: boolean | null;
    floorRow?: string | null;
    floorSlot?: number | null;
    facing?: string | null;
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
    useModalDismiss(onClose, true, !isPending);
    const isPresetU = [42, 45, 47, 48, 30, 24, 12, 9, 4].includes(rack.totalU ?? 42);
    const [customU, setCustomU] = useState(!isPresetU);
    // Same stale-boolean hazard as add-rack-form: guard on the result object
    // so the effect can't re-fire for an already-handled success either.
    const lastHandledRef = useRef<unknown>(null);

    useEffect(() => {
        if (state?.success && lastHandledRef.current !== state) {
            lastHandledRef.current = state;
            router.refresh();
            onClose();
        }
    }, [state, onClose, router]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-ops-border p-5">
                    <div className="flex items-center gap-2">
                        <Server className="size-4 text-ops-accent" />
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Edit rack</h2>
                    </div>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form action={action} className="p-5">
                    <input type="hidden" name="id" value={rack.id} />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                                Rack Name *
                            </label>
                            <input
                                name="name"
                                defaultValue={rack.name}
                                required
                                className={fieldClass}
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                                Zone
                            </label>
                            <input
                                name="zone"
                                defaultValue={rack.zone || ""}
                                placeholder="e.g. Zone A"
                                className={fieldClass}
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                                Total U
                            </label>
                            <select
                                name={customU ? undefined : "totalU"}
                                defaultValue={isPresetU ? (rack.totalU || 42) : "custom"}
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
                                    defaultValue={rack.totalU ?? undefined}
                                    min={1}
                                    max={60}
                                    required
                                    placeholder="Jumlah U (1-60)"
                                    className={`${fieldClass} mt-2`}
                                />
                            )}
                        </div>

<div className="md:col-span-2 grid grid-cols-3 gap-4">
                            <div>
                                <label className="mb-1 block text-[13px] font-medium text-ops-muted">Floor Row</label>
                                <input
                                    name="floorRow"
                                    defaultValue={rack.floorRow ?? ""}
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
                                    defaultValue={rack.floorSlot ?? ""}
                                    placeholder="1"
                                    className={fieldClass}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-[13px] font-medium text-ops-muted">Facing</label>
                                <select
                                    name="facing"
                                    defaultValue={rack.facing ?? "front"}
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

                        <div className="md:col-span-2">
                            <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                                Location
                            </label>
                            <select
                                name="locationId"
                                defaultValue={rack.locationId?.toString() || ""}
                                className={fieldClass}
                            >
                                <option value="">-- No Location --</option>
                                {locations.map(loc => (
                                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 mt-4">
                        {/* Hidden twin first: an unchecked checkbox submits
                            nothing, so "false" must be sent explicitly (and
                            the checked twin "on" wins via last-key-wins). */}
                        <input type="hidden" name="isAuditable" value="false" />
                        <input
                            type="checkbox"
                            name="isAuditable"
                            defaultChecked={rack.isAuditable ?? true}
                            value="on"
                        />
                        <label className="text-[13px] font-medium text-ops-muted">Include in audit</label>
                    </div>

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

                    <div className="mt-6 flex gap-3">
                        <ActionButton type="button" variant="secondary" onClick={onClose} className="flex-1">
                            Cancel
                        </ActionButton>
                        <ActionButton type="submit" isPending={isPending} className="flex-1">
                            Save changes
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
