"use client";

import { updateLocation } from "@/actions/locations";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface EditLocationModalProps {
    location: {
        id: number;
        name: string;
        description: string | null;
        tempThresholdC?: number | null;
        excludeTempCheck?: boolean | null;
        floorPlanPath?: string | null;
    };
    onClose: () => void;
}

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";
const fieldClass = "ops-input h-9 w-full px-3 text-sm";
const hintClass = "mt-1 text-xs text-ops-muted";

export default function EditLocationModal({ location, onClose }: EditLocationModalProps) {
    const [state, action, isPending] = useActionState(updateLocation, undefined);
    const router = useRouter();
    useModalDismiss(onClose, true, !isPending);

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, onClose, router]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)] animate-scale-in">
                <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Edit Location</h3>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form action={action} className="p-5">
                    <input type="hidden" name="id" value={location.id} />

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="edit-location-name" className={labelClass}>
                                Location Name *
                            </label>
                            <input
                                id="edit-location-name"
                                name="name"
                                required
                                defaultValue={location.name}
                                className={fieldClass}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit-location-description" className={labelClass}>
                                Description
                            </label>
                            <input
                                id="edit-location-description"
                                name="description"
                                defaultValue={location.description || ""}
                                className={fieldClass}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit-location-temp" className={labelClass}>
                                Batas Suhu Ruangan (°C)
                            </label>
                            <input
                                id="edit-location-temp"
                                name="tempThresholdC"
                                type="number"
                                step="0.5"
                                min={10}
                                max={60}
                                defaultValue={location.tempThresholdC ?? 27}
                                className={`${fieldClass} tabular-nums`}
                            />
                            <p className={hintClass}>
                                Suhu lebih dari batas +3°C saat audit otomatis membuat incident.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="edit-location-floorplan" className={labelClass}>
                                Floor Plan (3D view)
                            </label>
                            {location.floorPlanPath && (
                                <div className="mb-2 flex items-center gap-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={location.floorPlanPath} alt="Current floor plan" className="h-16 w-24 rounded border border-ops-border-strong object-cover" />
                                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ops-muted">
                                        <input type="checkbox" name="removeFloorPlan" className="size-4 rounded border-ops-border-strong" />
                                        Remove
                                    </label>
                                </div>
                            )}
                            <input
                                id="edit-location-floorplan"
                                type="file"
                                name="floorPlan"
                                accept="image/png,image/jpeg,image/webp"
                                className="block w-full text-sm text-ops-muted file:mr-3 file:rounded-md file:border-0 file:bg-ops-surface-raised file:px-3 file:py-1.5 file:text-ops-text"
                            />
                            <p className={hintClass}>
                                PNG/JPG/WebP, maks 5 MB. Dipakai sebagai lantai di tampilan 3D rack.
                            </p>
                        </div>

                        <div>
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-ops-muted">
                                <input
                                    type="checkbox"
                                    name="excludeTempCheck"
                                    defaultChecked={location.excludeTempCheck ?? false}
                                    className="size-4 rounded border-ops-border-strong"
                                />
                                Kecualikan dari audit suhu
                            </label>
                        </div>
                    </div>

                    {state?.message && !state?.success && (
                        <div className="mt-3 text-sm text-ops-danger">{state.message}</div>
                    )}

                    <div className="mt-6 flex gap-2">
                        <ActionButton
                            type="button"
                            variant="secondary"
                            onClick={onClose}
                            className="flex-1"
                        >
                            Cancel
                        </ActionButton>
                        <ActionButton
                            type="submit"
                            isPending={isPending}
                            className="flex-1"
                        >
                            Save Changes
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
