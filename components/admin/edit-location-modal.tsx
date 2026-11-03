"use client";

import { updateLocation } from "@/actions/locations";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";

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

export default function EditLocationModal({ location, onClose }: EditLocationModalProps) {
    const [state, action, isPending] = useActionState(updateLocation, undefined);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, onClose, router]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-ops-surface rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-ops-text">Edit Location</h3>
                    <button
                        onClick={onClose}
                        className="text-ops-muted hover:text-ops-muted dark:hover:text-ops-muted"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form action={action}>
                    <input type="hidden" name="id" value={location.id} />

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                Location Name *
                            </label>
                            <input
                                name="name"
                                required
                                defaultValue={location.name}
                                className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                Description
                            </label>
                            <input
                                name="description"
                                defaultValue={location.description || ""}
                                className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                Batas Suhu Ruangan (°C)
                            </label>
                            <input
                                name="tempThresholdC"
                                type="number"
                                step="0.5"
                                min={10}
                                max={60}
                                defaultValue={location.tempThresholdC ?? 27}
                                className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                            />
                            <p className="mt-1 text-xs text-ops-subtle">
                                Suhu lebih dari batas +3°C saat audit otomatis membuat incident.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                Floor Plan (3D view)
                            </label>
                            {location.floorPlanPath && (
                                <div className="mb-2 flex items-center gap-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={location.floorPlanPath} alt="Current floor plan" className="h-16 w-24 rounded border border-ops-border-strong object-cover" />
                                    <label className="flex items-center gap-2 text-sm text-ops-muted cursor-pointer">
                                        <input type="checkbox" name="removeFloorPlan" className="size-4 rounded border-ops-border-strong" />
                                        Remove
                                    </label>
                                </div>
                            )}
                            <input
                                type="file"
                                name="floorPlan"
                                accept="image/png,image/jpeg,image/webp"
                                className="block w-full text-sm text-ops-muted file:mr-3 file:rounded-md file:border-0 file:bg-ops-surface-raised file:px-3 file:py-1.5 dark:file:bg-ops-surface-raised dark:file:text-ops-text"
                            />
                            <p className="mt-1 text-xs text-ops-subtle">
                                PNG/JPG/WebP, maks 5 MB. Dipakai sebagai lantai di tampilan 3D rack.
                            </p>
                        </div>

                        <div>
                            <label className="flex items-center gap-2 text-sm text-ops-muted cursor-pointer">
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
                        <div className="mt-3 text-ops-danger text-sm">{state.message}</div>
                    )}

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-ops-border-strong rounded-md text-ops-muted hover:bg-ops-surface dark:hover:bg-ops-surface-raised"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex-1 bg-ops-accent text-ops-accent-fg px-4 py-2 rounded-md hover:bg-ops-accent-hover flex items-center justify-center gap-2 disabled:opacity-50"
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
