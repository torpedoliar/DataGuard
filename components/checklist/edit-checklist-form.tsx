"use client";

import { useActionState, useState, useEffect } from "react";
import { updateChecklist } from "@/actions/checklist";
import { Loader2, Upload, CheckCircle, XCircle, X, Trash2, Camera } from "lucide-react";
import clsx from "clsx";

type Category = { id: number; name: string };
type Device = { id: number; name: string; locationName: string | null; categoryId: number };
type ChecklistItem = {
    id: number;
    deviceId: number;
    status: "OK" | "NOT OK";
    remarks: string | null;
    photoPath: string | null;
    device: Device;
};

interface EditChecklistFormProps {
    entryId: number;
    checkDate: string;
    checkTime: string;
    shift: "Pagi" | "Siang" | "Malam";
    categories: Category[];
    devices: Device[];
    items: ChecklistItem[];
}

export default function EditChecklistForm({
    entryId,
    checkDate,
    checkTime,
    shift,
    categories,
    devices,
    items,
}: EditChecklistFormProps) {
    // Create a map of existing items by device ID
    const itemsByDevice = new Map(items.map(item => [item.deviceId, item]));

    // Only render devices that were ACTUALLY audited in this entry.
    // Un-audited devices must never be submitted as "OK" or injected into the entry!
    const auditedDevices = devices.filter(d => itemsByDevice.has(d.id));
    const relevantCategories = categories.filter(cat => auditedDevices.some(d => d.categoryId === cat.id));
    const displayCategories = relevantCategories.length > 0 ? relevantCategories : [{ id: 0, name: "Audited Devices" }];

    const [state, action, isPending] = useActionState(updateChecklist, undefined);
    const [activeTab, setActiveTab] = useState(displayCategories[0]?.id);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (formData: FormData) => {
        formData.set("entryId", String(entryId));
        setIsSubmitting(true);
        try {
            await action(formData);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle success by redirecting
    useEffect(() => {
        if (state?.success) {
            window.location.href = "/report";
        }
    }, [state?.success]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-ops-surface rounded-lg shadow-xl max-w-5xl w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-ops-border">
                    <div>
                        <h2 className="text-xl font-bold text-ops-text ">Edit Checklist Entry</h2>
                        <p className="text-sm text-ops-muted mt-1">
                            {new Date(checkDate).toLocaleDateString("en-GB", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                    </div>
                    <button
                        onClick={() => window.location.href = "/report"}
                        className="text-ops-muted hover:text-ops-text "
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Form Content */}
                <form action={handleSubmit} className="flex-1 overflow-y-auto">
                    <input type="hidden" name="entryId" value={entryId} />

                    {/* Header Info */}
                    <div className="p-6 border-b border-ops-border bg-ops-surface-raised ">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-ops-text mb-1">Date</label>
                                <input
                                    type="date"
                                    name="checkDate"
                                    defaultValue={checkDate}
                                    required
                                    className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface  text-ops-text  focus:outline-none focus:ring-2 focus:ring-ops-info"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ops-text mb-1">Time</label>
                                <input
                                    type="time"
                                    name="checkTime"
                                    defaultValue={checkTime}
                                    required
                                    className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface  text-ops-text  focus:outline-none focus:ring-2 focus:ring-ops-info"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ops-text mb-1">Shift</label>
                                <select
                                    name="shift"
                                    defaultValue={shift}
                                    className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface  text-ops-text  focus:outline-none focus:ring-2 focus:ring-ops-info"
                                >
                                    <option value="Pagi">Pagi</option>
                                    <option value="Siang">Siang</option>
                                    <option value="Malam">Malam</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Categories Tabs — only show categories containing devices in this entry */}
                    {displayCategories.length > 1 && (
                        <div className="border-b border-ops-border">
                            <nav className="flex -mb-px overflow-x-auto" aria-label="Tabs">
                                {displayCategories.map((category) => (
                                    <button
                                        key={category.id}
                                        type="button"
                                        onClick={() => setActiveTab(category.id)}
                                        className={clsx(
                                            activeTab === category.id
                                                ? "border-ops-info text-ops-info"
                                                : "border-transparent text-ops-muted hover:text-ops-text hover:border-ops-border-strong",
                                            "whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm transition-colors"
                                        )}
                                    >
                                        {category.name}
                                    </button>
                                ))}
                            </nav>
                        </div>
                    )}

                    {/* Devices List — only render devices that belong to this audit entry */}
                    <div className="p-6 space-y-8">
                        {displayCategories.map((category) => {
                            const catDevices = displayCategories.length <= 1
                                ? auditedDevices
                                : auditedDevices.filter(d => d.categoryId === category.id);

                            return (
                                <div key={category.id} className={clsx(activeTab === category.id || displayCategories.length <= 1 ? "block" : "hidden")}>
                                    <h3 className="text-lg font-medium text-ops-text  mb-4">{category.name} Devices ({catDevices.length})</h3>
                                    <div className="space-y-6">
                                        {catDevices.map((device) => {
                                            const existingItem = itemsByDevice.get(device.id);
                                            return (
                                                <DeviceRow
                                                    key={device.id}
                                                    device={device}
                                                    existingItem={existingItem}
                                                />
                                            );
                                        })}
                                        {catDevices.length === 0 && (
                                            <p className="text-ops-muted italic">No audited devices in this category.</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Footer Actions */}
                    <div className="p-6 border-t border-ops-border bg-ops-surface-raised  rounded-b-lg flex justify-end items-center gap-4">
                        {state?.message && (
                            <p className={`text-sm ${state.success ? 'text-ops-success' : 'text-ops-danger'}`}>
                                {state.message}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={() => window.location.href = "/report"}
                            className="px-4 py-2 border border-ops-border-strong rounded-md text-ops-text hover:bg-ops-surface-raised "
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending || isSubmitting}
                            className="bg-ops-info-soft text-ops-info px-6 py-2.5 rounded-md hover:bg-ops-info/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ops-info shadow-sm flex items-center disabled:opacity-50"
                        >
                            {isPending || isSubmitting ? (
                                <>
                                    <Loader2 className="animate-spin h-5 w-5 mr-2" />
                                    Saving...
                                </>
                            ) : (
                                "Save Changes"
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function DeviceRow({
    device,
    existingItem,
}: {
    device: Device;
    existingItem?: ChecklistItem;
}) {
    const [status, setStatus] = useState<"OK" | "NOT OK">(
        existingItem?.status || "OK"
    );
    const [deletePhoto, setDeletePhoto] = useState(false);

    return (
        <div className="bg-ops-surface-raised  p-4 rounded-lg border border-ops-border hover:border-ops-info transition-colors">
            <input type="hidden" name="deviceId" value={device.id} />
            <input type="hidden" name={`existingPhoto-${device.id}`} value={existingItem?.photoPath || ""} />

            <div className="flex flex-col md:flex-row md:items-start gap-4">
                {/* Device Info */}
                <div className="md:w-1/4">
                    <p className="font-semibold text-ops-text ">{device.name}</p>
                    <p className="text-sm text-ops-muted">{device.locationName || "-"}</p>
                </div>

                {/* Status Selection */}
                <div className="md:w-1/3 flex gap-2">
                    <label className={clsx(
                        "flex-1 cursor-pointer border rounded-md p-2 flex flex-col items-center gap-1 transition-all",
                        status === "OK"
                            ? "bg-ops-success-soft border-ops-success text-ops-success ring-1 ring-ops-success"
                            : "bg-ops-surface  border-ops-border-strong text-ops-muted hover:bg-ops-surface-raised"
                    )}>
                        <input
                            type="radio"
                            name={`status-${device.id}`}
                            value="OK"
                            className="sr-only"
                            checked={status === "OK"}
                            onChange={() => setStatus("OK")}
                        />
                        <CheckCircle className="h-5 w-5" />
                        <span className="text-xs font-medium">OK</span>
                    </label>

                    <label className={clsx(
                        "flex-1 cursor-pointer border rounded-md p-2 flex flex-col items-center gap-1 transition-all",
                        status === "NOT OK"
                            ? "bg-ops-danger-soft border-ops-danger text-ops-danger ring-1 ring-ops-danger"
                            : "bg-ops-surface  border-ops-border-strong text-ops-muted hover:bg-ops-surface-raised"
                    )}>
                        <input
                            type="radio"
                            name={`status-${device.id}`}
                            value="NOT OK"
                            className="sr-only"
                            checked={status === "NOT OK"}
                            onChange={() => setStatus("NOT OK")}
                        />
                        <XCircle className="h-5 w-5" />
                        <span className="text-xs font-medium">NOT OK</span>
                    </label>
                </div>

                {/* Remarks & Photo */}
                <div className="md:flex-1 w-full space-y-3">
                    <textarea
                        name={`remarks-${device.id}`}
                        defaultValue={existingItem?.remarks || ""}
                        placeholder="Remarks (optional)"
                        rows={2}
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface  text-ops-text  text-sm focus:outline-none focus:ring-1 focus:ring-ops-info"
                    />

                    {/* Existing Photo Display */}
                    {existingItem?.photoPath && !deletePhoto && (
                        <div className="flex items-center gap-3 p-2 bg-ops-surface-raised rounded">
                            <div className="h-16 w-16 rounded overflow-hidden bg-ops-surface-sunken ">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={existingItem.photoPath}
                                    alt="Device photo"
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm text-ops-muted">Existing photo</p>
                                <label className="flex items-center gap-2 text-sm text-ops-danger cursor-pointer mt-1">
                                    <input
                                        type="checkbox"
                                        name={`deletePhoto-${device.id}`}
                                        checked={deletePhoto}
                                        onChange={(e) => setDeletePhoto(e.target.checked)}
                                        className="rounded border-ops-border-strong text-ops-danger focus:ring-ops-danger"
                                    />
                                    <Trash2 className="h-4 w-4" />
                                    Remove photo
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Upload New Photo */}
                    {(status === "NOT OK" || existingItem?.photoPath) && (
                        <div className="grid grid-cols-2 gap-2 text-sm text-ops-muted">
                            <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-md border border-ops-border-strong px-2 py-2 font-semibold hover:border-ops-info">
                                <Camera className="h-4 w-4" />
                                Kamera
                                <input
                                    type="file"
                                    name={`photo-${device.id}`}
                                    accept="image/*"
                                    capture="environment"
                                    className="sr-only"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file && file.size > 10 * 1024 * 1024) {
                                            alert("Ukuran file maksimal 10MB");
                                            e.target.value = "";
                                        }
                                    }}
                                />
                            </label>
                            <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-md border border-ops-border-strong px-2 py-2 font-semibold hover:border-ops-info">
                                <Upload className="h-4 w-4" />
                                Galeri
                                <input
                                    type="file"
                                    name={`photo-${device.id}`}
                                    accept="image/*"
                                    className="sr-only"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file && file.size > 10 * 1024 * 1024) {
                                            alert("Ukuran file maksimal 10MB");
                                            e.target.value = "";
                                        }
                                    }}
                                />
                            </label>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
