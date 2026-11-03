"use client";

import { useState } from "react";
import { deleteDevice, getDeviceDeletionUsage, type DeviceDeletionUsageInfo } from "@/actions/master-data";
import { X, AlertTriangle, Loader2, Info } from "lucide-react";

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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-ops-surface rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-ops-border sticky top-0 bg-ops-surface z-10">
                    <div className="flex items-center gap-2">
                        <div className="size-10 rounded-full bg-ops-danger-soft flex items-center justify-center text-ops-danger">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <h3 className="text-lg font-bold text-ops-text">Delete Device</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-ops-muted hover:text-ops-muted dark:hover:text-ops-muted"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    <div>
                        <p className="text-ops-muted">
                            Are you sure you want to delete:
                        </p>
                        <p className="mt-2 font-semibold text-ops-text bg-ops-surface-raised p-3 rounded">
                            {deviceName}
                        </p>
                    </div>

                    <div className="bg-ops-warning-soft border border-ops-warning/20 rounded-lg p-3">
                        <p className="text-sm text-ops-warning">
                            ⚠️ This action cannot be undone. The device will be permanently removed.
                        </p>
                    </div>

                    {/* Blocked: related history/data cannot be deleted */}
                    {blocked && usageInfo && (
                        <div className="bg-ops-danger-soft border border-ops-danger/20 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2 text-ops-danger">
                                <Info className="h-5 w-5" />
                                <p className="font-semibold">Device cannot be deleted</p>
                            </div>
                            <p className="text-sm text-ops-muted">
                                This device is referenced by <strong>{usageInfo.blockingCount}</strong> related record{usageInfo.blockingCount === 1 ? "" : "s"} (checklist history, incidents, ports, syslog/SIEM data). Related data cannot be deleted.
                            </p>
                            <p className="text-sm text-ops-muted">
                                To retire this device, decommission it instead with the <strong>Active/Inactive</strong> toggle in the device table.
                            </p>
                            {usageInfo.checklistPreview.length > 0 && (
                                <>
                                    <p className="text-sm text-ops-muted">
                                        Recent checklist history ({usageInfo.checklistPreview.length} of {usageInfo.dependencies.checklistItems} shown):
                                    </p>
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                        {usageInfo.checklistPreview.map((entry, idx) => (
                                            <div key={idx} className="text-xs text-ops-muted flex items-center gap-2">
                                                <span className="font-mono">{entry.date}</span>
                                                <span>at</span>
                                                <span className="font-mono">{entry.time}</span>
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
                        <div className="bg-ops-success-soft border border-ops-success/20 rounded-lg p-3">
                            <p className="text-sm text-ops-success">
                                No related records found — this device can be safely deleted.
                            </p>
                        </div>
                    )}

                    {!blocked && (
                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                Reason for Deletion *
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g., Device decommissioned, replaced with new equipment, etc."
                                rows={3}
                                className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-danger"
                            />
                            {error && (
                                <p className="mt-1 text-sm text-ops-danger">{error}</p>
                            )}
                        </div>
                    )}

                    {!usageInfo && (
                        <button
                            onClick={handleCheckUsage}
                            disabled={isChecking}
                            className="w-full px-4 py-2 bg-ops-surface-raised text-ops-muted rounded-md hover:bg-ops-surface-raised dark:hover:bg-ops-surface-raised transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isChecking ? (
                                <>
                                    <Loader2 className="animate-spin h-4 w-4" />
                                    Checking...
                                </>
                            ) : (
                                "Check Device Usage"
                            )}
                        </button>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex gap-3 p-4 border-t border-ops-border bg-ops-surface/50 rounded-b-lg sticky bottom-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isDeleting}
                        className="flex-1 px-4 py-2 border border-ops-border-strong rounded-md text-ops-muted hover:bg-ops-surface dark:hover:bg-ops-surface-raised disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    {canDelete && (
                        <button
                            onClick={handleDelete}
                            disabled={isDeleting || !reason.trim()}
                            className="flex-1 bg-ops-danger text-ops-status-fg px-4 py-2 rounded-md hover:bg-ops-danger flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="animate-spin h-4 w-4" />
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <AlertTriangle className="h-4 w-4" />
                                    Delete Device
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}