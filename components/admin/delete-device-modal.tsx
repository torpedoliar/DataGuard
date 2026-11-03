"use client";

import { useState } from "react";
import { deleteDevice, getDeviceDeletionUsage, type DeviceDeletionUsageInfo } from "@/actions/master-data";
import ActionButton from "@/components/ui/action-button";
import { X, AlertTriangle, Info } from "lucide-react";

interface DeleteDeviceModalProps {
    deviceId: number;
    deviceName: string;
    onClose: () => void;
    onSuccess: () => void;
}

export default function DeleteDeviceModal({
    deviceId,
    deviceName,
    onClose,
    onSuccess,
}: DeleteDeviceModalProps) {
    const [reason, setReason] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState("");
    const [usageInfo, setUsageInfo] = useState<DeviceDeletionUsageInfo | null>(null);

    // "Check Device Usage" is a strictly read-only preflight: it reports
    // dependency counts and a checklist history preview and never mutates
    // the device or its data.
    const handleCheckUsage = async () => {
        setIsChecking(true);
        setError("");
        try {
            const result = await getDeviceDeletionUsage(deviceId);
            if (result.success) {
                setUsageInfo(result);
            } else {
                setError(result.message);
            }
        } catch (_err) {
            setError("Failed to check device usage");
        } finally {
            setIsChecking(false);
        }
    };

    const handleDelete = async () => {
        if (!reason.trim()) {
            setError("Please provide a reason for deletion");
            return;
        }

        setIsDeleting(true);
        setError("");

        try {
            const result = await deleteDevice(deviceId, reason);
            if (result?.success) {
                onSuccess();
            } else if (result?.message) {
                setError(result.message);
            }
        } catch (_err) {
            setError("Failed to delete device");
        } finally {
            setIsDeleting(false);
        }
    };

    const canDelete = usageInfo !== null && usageInfo.canDelete;
    const blocked = usageInfo !== null && !usageInfo.canDelete;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="ops-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ops-border bg-ops-surface p-4">
                    <div className="flex items-center gap-2">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-ops-danger-soft text-ops-danger">
                            <AlertTriangle className="size-4" />
                        </div>
                        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Delete device</h3>
                    </div>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                {/* Content */}
                <div className="space-y-4 p-4">
                    <div>
                        <p className="text-[13px] text-ops-muted">
                            Are you sure you want to delete:
                        </p>
                        <p className="mt-2 rounded-md bg-ops-surface-raised p-3 font-semibold text-ops-text">
                            {deviceName}
                        </p>
                    </div>

                    <div className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5">
                        <p className="text-[13px] text-ops-warning">
                            This action cannot be undone. The device will be permanently removed.
                        </p>
                    </div>

                    {/* Blocked: related history/data cannot be deleted */}
                    {blocked && usageInfo && (
                        <div className="space-y-3 rounded-md border border-ops-danger/25 bg-ops-danger-soft p-4">
                            <div className="flex items-center gap-2 text-ops-danger">
                                <Info className="size-4" />
                                <p className="text-[13px] font-semibold">Device cannot be deleted</p>
                            </div>
                            <p className="text-[13px] text-ops-muted">
                                This device is referenced by <strong>{usageInfo.blockingCount}</strong> related record{usageInfo.blockingCount === 1 ? "" : "s"} (checklist history, incidents, ports, syslog/SIEM data). Related data cannot be deleted.
                            </p>
                            <p className="text-[13px] text-ops-muted">
                                To retire this device, decommission it instead with the <strong>Active/Inactive</strong> toggle in the device table.
                            </p>
                            {usageInfo.checklistPreview.length > 0 && (
                                <>
                                    <p className="text-[13px] text-ops-muted">
                                        Recent checklist history ({usageInfo.checklistPreview.length} of {usageInfo.dependencies.checklistItems} shown):
                                    </p>
                                    <div className="max-h-40 space-y-1 overflow-y-auto">
                                        {usageInfo.checklistPreview.map((entry, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-xs text-ops-muted">
                                                <span className="font-mono tabular-nums">{entry.date}</span>
                                                <span>at</span>
                                                <span className="font-mono tabular-nums">{entry.time}</span>
                                                <span>by</span>
                                                <span className="font-medium">{entry.user}</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* No references found: safe to delete */}
                    {canDelete && usageInfo && (
                        <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5">
                            <p className="text-[13px] text-ops-success">
                                No related records found — this device can be safely deleted.
                            </p>
                        </div>
                    )}

                    {!blocked && (
                        <div>
                            <label className="mb-1 block text-[13px] font-medium text-ops-muted">
                                Reason for deletion *
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g., Device decommissioned, replaced with new equipment, etc."
                                rows={3}
                                className="ops-input w-full px-3 py-2 text-sm"
                            />
                            {error && (
                                <p className="mt-1 text-[13px] text-ops-danger">{error}</p>
                            )}
                        </div>
                    )}

                    {!usageInfo && (
                        <ActionButton
                            type="button"
                            variant="secondary"
                            onClick={handleCheckUsage}
                            isPending={isChecking}
                            className="w-full"
                        >
                            Check device usage
                        </ActionButton>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="sticky bottom-0 flex gap-3 border-t border-ops-border bg-ops-surface p-4">
                    <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isDeleting} className="flex-1">
                        Cancel
                    </ActionButton>
                    {canDelete && (
                        <ActionButton type="button" variant="danger" onClick={handleDelete} isPending={isDeleting} disabled={!reason.trim()} className="flex-1" icon={<AlertTriangle className="size-4" />}>
                            Delete device
                        </ActionButton>
                    )}
                </div>
            </div>
        </div>
    );
}