"use client";

import { deleteBrand } from "@/actions/brands";
import { useState } from "react";
import { Loader2, AlertTriangle, X } from "lucide-react";

interface DeleteBrandModalProps {
    brandId: number;
    brandName: string;
    onClose: () => void;
    onSuccess: () => void;
}

export default function DeleteBrandModal({ brandId, brandName, onClose, onSuccess }: DeleteBrandModalProps) {
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [usageInfo, setUsageInfo] = useState<{ count: number; devices: string[] } | null>(null);

    const handleDelete = async () => {
        setIsDeleting(true);
        setError(null);

        try {
            const result = await deleteBrand(brandId);

            if (result?.success) {
                onSuccess();
            } else {
                setError(result?.message || "Failed to delete brand");
                if (result?.usageCount) {
                    setUsageInfo({
                        count: result.usageCount,
                        devices: result.devices || []
                    });
                }
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-card-dark w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="size-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 flex-shrink-0">
                            <AlertTriangle className="h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Delete Brand</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Are you sure you want to delete <span className="font-semibold text-slate-900 dark:text-white">&quot;{brandName}&quot;</span>?
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/50 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>

                            {usageInfo && (
                                <div className="mt-3">
                                    <p className="text-xs text-red-500 dark:text-red-400/80 mb-2">
                                        This brand is currently assigned to {usageInfo.count} device{usageInfo.count > 1 ? 's' : ''}:
                                    </p>
                                    <ul className="text-xs text-red-600/80 dark:text-red-300/80 list-disc list-inside space-y-1 max-h-32 overflow-y-auto pl-2">
                                        {usageInfo.devices.map((device, i) => (
                                            <li key={i}>{device}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3 mt-8">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isDeleting}
                            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="flex items-center justify-center gap-2 px-6 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                "Delete Brand"
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
