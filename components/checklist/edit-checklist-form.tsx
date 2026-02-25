"use client";

import { useActionState, useState, useEffect } from "react";
import { updateChecklist } from "@/actions/checklist";
import { Loader2, Upload, AlertTriangle, CheckCircle, XCircle, X, Trash2 } from "lucide-react";
import clsx from "clsx";

type Category = { id: number; name: string };
type Device = { id: number; name: string; locationName: string | null; categoryId: number };
type ChecklistItem = {
    id: number;
    deviceId: number;
    status: "OK" | "Warning" | "Error";
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
    const [state, action, isPending] = useActionState(updateChecklist, undefined);
    const [activeTab, setActiveTab] = useState(categories[0]?.id);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Create a map of existing items by device ID
    const itemsByDevice = new Map(items.map(item => [item.deviceId, item]));

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
            <div className="bg-white dark:bg-card-dark rounded-lg shadow-xl max-w-5xl w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Edit Checklist Entry</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {new Date(checkDate).toLocaleDateString("en-GB", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                    </div>
                    <button
                        onClick={() => window.location.href = "/report"}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Form Content */}
                <form action={handleSubmit} className="flex-1 overflow-y-auto">
                    <input type="hidden" name="entryId" value={entryId} />

                    {/* Header Info */}
                    <div className="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date</label>
                                <input
                                    type="date"
                                    name="checkDate"
                                    defaultValue={checkDate}
                                    required
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Time</label>
                                <input
                                    type="time"
                                    name="checkTime"
                                    defaultValue={checkTime}
                                    required
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Shift</label>
                                <select
                                    name="shift"
                                    defaultValue={shift}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="Pagi">Pagi</option>
                                    <option value="Siang">Siang</option>
                                    <option value="Malam">Malam</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Categories Tabs */}
                    <div className="border-b border-slate-200 dark:border-slate-700">
                        <nav className="flex -mb-px overflow-x-auto" aria-label="Tabs">
                            {categories.map((category) => (
                                <button
                                    key={category.id}
                                    type="button"
                                    onClick={() => setActiveTab(category.id)}
                                    className={clsx(
                                        activeTab === category.id
                                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                            : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300",
                                        "whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm transition-colors"
                                    )}
                                >
                                    {category.name}
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Devices List */}
                    <div className="p-6 space-y-8">
                        {categories.map((category) => (
                            <div key={category.id} className={clsx(activeTab === category.id ? "block" : "hidden")}>
                                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">{category.name} Devices</h3>
                                <div className="space-y-6">
                                    {devices.filter(d => d.categoryId === category.id).map((device) => {
                                        const existingItem = itemsByDevice.get(device.id);
                                        return (
                                            <DeviceRow
                                                key={device.id}
                                                device={device}
                                                existingItem={existingItem}
                                            />
                                        );
                                    })}
                                    {devices.filter(d => d.categoryId === category.id).length === 0 && (
                                        <p className="text-slate-500 dark:text-slate-400 italic">No devices in this category.</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer Actions */}
                    <div className="p-6 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-lg flex justify-end items-center gap-4">
                        {state?.message && (
                            <p className={`text-sm ${state.success ? 'text-green-600' : 'text-red-600'}`}>
                                {state.message}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={() => window.location.href = "/report"}
                            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending || isSubmitting}
                            className="bg-blue-600 text-white px-6 py-2.5 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm flex items-center disabled:opacity-50"
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
    const [status, setStatus] = useState<"OK" | "Warning" | "Error">(
        existingItem?.status || "OK"
    );
    const [deletePhoto, setDeletePhoto] = useState(false);

    return (
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 transition-colors">
            <input type="hidden" name="deviceId" value={device.id} />
            <input type="hidden" name={`existingPhoto-${device.id}`} value={existingItem?.photoPath || ""} />

            <div className="flex flex-col md:flex-row md:items-start gap-4">
                {/* Device Info */}
                <div className="md:w-1/4">
                    <p className="font-semibold text-slate-900 dark:text-white">{device.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{device.locationName || "-"}</p>
                </div>

                {/* Status Selection */}
                <div className="md:w-1/3 flex gap-2">
                    <label className={clsx(
                        "flex-1 cursor-pointer border rounded-md p-2 flex flex-col items-center gap-1 transition-all",
                        status === "OK"
                            ? "bg-green-50 dark:bg-green-500/10 border-green-500 text-green-700 dark:text-green-400 ring-1 ring-green-500"
                            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
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
                        status === "Warning"
                            ? "bg-yellow-50 dark:bg-yellow-500/10 border-yellow-500 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-500"
                            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}>
                        <input
                            type="radio"
                            name={`status-${device.id}`}
                            value="Warning"
                            className="sr-only"
                            checked={status === "Warning"}
                            onChange={() => setStatus("Warning")}
                        />
                        <AlertTriangle className="h-5 w-5" />
                        <span className="text-xs font-medium">Warning</span>
                    </label>

                    <label className={clsx(
                        "flex-1 cursor-pointer border rounded-md p-2 flex flex-col items-center gap-1 transition-all",
                        status === "Error"
                            ? "bg-red-50 dark:bg-red-500/10 border-red-500 text-red-700 dark:text-red-400 ring-1 ring-red-500"
                            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}>
                        <input
                            type="radio"
                            name={`status-${device.id}`}
                            value="Error"
                            className="sr-only"
                            checked={status === "Error"}
                            onChange={() => setStatus("Error")}
                        />
                        <XCircle className="h-5 w-5" />
                        <span className="text-xs font-medium">Error</span>
                    </label>
                </div>

                {/* Remarks & Photo */}
                <div className="md:flex-1 w-full space-y-3">
                    <textarea
                        name={`remarks-${device.id}`}
                        defaultValue={existingItem?.remarks || ""}
                        placeholder="Remarks (optional)"
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />

                    {/* Existing Photo Display */}
                    {existingItem?.photoPath && !deletePhoto && (
                        <div className="flex items-center gap-3 p-2 bg-slate-100 dark:bg-slate-700 rounded">
                            <div className="h-16 w-16 rounded overflow-hidden bg-slate-200 dark:bg-slate-600">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={existingItem.photoPath}
                                    alt="Device photo"
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm text-slate-600 dark:text-slate-300">Existing photo</p>
                                <label className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 cursor-pointer mt-1">
                                    <input
                                        type="checkbox"
                                        name={`deletePhoto-${device.id}`}
                                        checked={deletePhoto}
                                        onChange={(e) => setDeletePhoto(e.target.checked)}
                                        className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                                    />
                                    <Trash2 className="h-4 w-4" />
                                    Remove photo
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Upload New Photo */}
                    {(status === "Warning" || status === "Error" || existingItem?.photoPath) && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                            <Upload className="h-4 w-4" />
                            <input
                                type="file"
                                name={`photo-${device.id}`}
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file && file.size > 10 * 1024 * 1024) {
                                        alert("Ukuran file maksimal 10MB");
                                        e.target.value = "";
                                    }
                                }}
                                className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-blue-500/10 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-500/20"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
