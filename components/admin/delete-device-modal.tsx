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
            <div className="bg-white dark:bg-surface rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-surface z-10">
                    <div className="flex items-center gap-2">
                        <div className="size-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Device</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    <div>
                        <p className="text-slate-700 dark:text-slate-300">
                            Are you sure you want to delete:
                        </p>
                        <p className="mt-2 font-semibold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 p-3 rounded">
                            {deviceName}
                        </p>
                    </div>

                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                        <p className="text-sm text-yellow-700 dark:text-yellow-400">
                            ⚠️ This action cannot be undone. The device will be permanently removed.
                        </p>
                    </div>

                    {/* Blocked: related history/data cannot be deleted */}
                    {blocked && usageInfo && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                                <Info className="h-5 w-5" />
                                <p className="font-semibold">Device cannot be deleted</p>
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                This device is referenced by <strong>{usageInfo.blockingCount}</strong> related record{usageInfo.blockingCount === 1 ? "" : "s"} (checklist history, incidents, ports, syslog/SIEM data). Related data cannot be deleted.
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                To retire this device, decommission it instead with the <strong>Active/Inactive</strong> toggle in the device table.
                            </p>
                            {usageInfo.checklistPreview.length > 0 && (
                                <>
                                    <p className="text-sm text-slate-700 dark:text-slate-300">
                                        Recent checklist history ({usageInfo.checklistPreview.length} of {usageInfo.dependencies.checklistItems} shown):
                                    </p>
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                        {usageInfo.checklistPreview.map((entry, idx) => (
                                            <div key={idx} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
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
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                            <p className="text-sm text-emerald-700 dark:text-emerald-400">
                                No related records found — this device can be safely deleted.
                            </p>
                        </div>
                    )}

                    {!blocked && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Reason for Deletion *
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g., Device decommissioned, replaced with new equipment, etc."
                                rows={3}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            {error && (
                                <p className="mt-1 text-sm text-red-500">{error}</p>
                            )}
                        </div>
                    )}

                    {!usageInfo && (
                        <button
                            onClick={handleCheckUsage}
                            disabled={isChecking}
                            className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
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
                <div className="flex gap-3 p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-lg sticky bottom-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isDeleting}
                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    {canDelete && (
                        <button
                            onClick={handleDelete}
                            disabled={isDeleting || !reason.trim()}
                            className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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