"use client";

import { deleteBrand } from "@/actions/brands";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import { Modal } from "@/components/ui/modal";

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
        } catch (_err) {
            setError("An unexpected error occurred");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title="Delete Brand"
            description={`Are you sure you want to delete "${brandName}"?`}
        >
            <div className="mb-6 flex items-center gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ops-danger-soft text-ops-danger">
                    <AlertTriangle aria-hidden="true" className="size-6" />
                </div>
                <p className="text-sm text-ops-muted">
                    This action is permanent and cannot be undone.
                </p>
            </div>

            {error && (
                <div className="mb-6 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5" role="alert">
                    <p className="text-[13px] font-medium text-ops-danger">{error}</p>

                    {usageInfo && (
                        <div className="mt-3">
                            <p className="mb-2 text-xs text-ops-danger/80">
                                This brand is currently assigned to {usageInfo.count} device{usageInfo.count > 1 ? 's' : ''}:
                            </p>
                            <ul className="max-h-32 list-inside list-disc space-y-1 overflow-y-auto pl-2 text-xs text-ops-danger/80">
                                {usageInfo.devices.map((device, i) => (
                                    <li key={i}>{device}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-8 flex items-center justify-end gap-2">
                <ActionButton
                    type="button"
                    variant="secondary"
                    onClick={onClose}
                    disabled={isDeleting}
                >
                    Cancel
                </ActionButton>
                <ActionButton
                    type="button"
                    variant="danger"
                    onClick={handleDelete}
                    isPending={isDeleting}
                >
                    {isDeleting ? "Deleting..." : "Delete Brand"}
                </ActionButton>
            </div>
        </Modal>
    );
}
