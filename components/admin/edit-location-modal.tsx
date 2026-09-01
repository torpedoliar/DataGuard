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
            <div className="bg-white dark:bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Location</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form action={action}>
                    <input type="hidden" name="id" value={location.id} />

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Location Name *
                            </label>
                            <input
                                name="name"
                                required
                                defaultValue={location.name}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Description
                            </label>
                            <input
                                name="description"
                                defaultValue={location.description || ""}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Batas Suhu Ruangan (°C)
                            </label>
                            <input
                                name="tempThresholdC"
                                type="number"
                                step="0.5"
                                min={10}
                                max={60}
                                defaultValue={location.tempThresholdC ?? 27}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <p className="mt-1 text-xs text-slate-500">
                                Suhu lebih dari batas +3°C saat audit otomatis membuat incident.
                            </p>
                        </div>

                        <div>
                            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="excludeTempCheck"
                                    defaultChecked={location.excludeTempCheck ?? false}
                                    className="size-4 rounded border-slate-300 dark:border-slate-600"
                                />
                                Kecualikan dari audit suhu
                            </label>
                        </div>
                    </div>

                    {state?.message && !state?.success && (
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
