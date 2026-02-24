
"use client";

import { useActionState, useState } from "react";
import { submitChecklist } from "@/actions/checklist";
import { Loader2, Upload, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import clsx from "clsx";

type Category = { id: number; name: string };
type Device = { id: number; name: string; locationName: string | null; categoryId: number };

export default function ChecklistForm({
    categories,
    devices,
    prefillDeviceId,
}: {
    categories: Category[];
    devices: Device[];
    prefillDeviceId?: number;
}) {
    const filteredDevices = prefillDeviceId ? devices.filter(d => d.id === prefillDeviceId) : devices;
    const targetCategory = prefillDeviceId ? filteredDevices[0]?.categoryId : categories[0]?.id;

    const [state, action, isPending] = useActionState(submitChecklist, undefined);
    const [activeTab, setActiveTab] = useState(targetCategory || categories[0]?.id);

    // Helper to get today's date and time
    const today = new Date().toISOString().split("T")[0];
    const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    return (
        <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700" suppressHydrationWarning>
            <form action={action}>
                {/* Header Info */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-t-lg">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date</label>
                            <input type="date" name="checkDate" defaultValue={today} required className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Time</label>
                            <input type="time" name="checkTime" defaultValue={now} required className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Shift</label>
                            <select name="shift" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
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
                                {filteredDevices.filter(d => d.categoryId === category.id).map((device) => (
                                    <DeviceRow key={device.id} device={device} isHighlighted={prefillDeviceId === device.id} />
                                ))}
                                {filteredDevices.filter(d => d.categoryId === category.id).length === 0 && (
                                    <p className="text-slate-500 dark:text-slate-400 italic">No devices in this category.</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-lg flex justify-end items-center gap-4">
                    {state?.message && <p className={clsx("text-sm", state.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>{state.message}</p>}
                    {state?.success && <p className="text-green-600 dark:text-green-400 text-sm">Checklist submitted successfully!</p>}

                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-blue-600 text-white px-6 py-2.5 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm flex items-center disabled:opacity-50"
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="animate-spin h-5 w-5 mr-2" />
                                Submitting...
                            </>
                        ) : (
                            "Submit Checklist"
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}

function DeviceRow({ device, isHighlighted }: { device: Device; isHighlighted?: boolean }) {
    const [status, setStatus] = useState<"OK" | "Warning" | "Error">("OK");

    return (
        <div className={clsx(
            "p-4 rounded-lg border transition-colors",
            isHighlighted
                ? "bg-blue-50/50 dark:bg-blue-900/10 border-blue-400 dark:border-blue-500 shadow-sm"
                : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700"
        )}>
            <input type="hidden" name="deviceId" value={device.id} />
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
                        status === "OK" ? "bg-green-50 dark:bg-green-900/20 border-green-500 text-green-700 dark:text-green-400 ring-1 ring-green-500" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}>
                        <input type="radio" name={`status-${device.id}`} value="OK" className="sr-only" checked={status === "OK"} onChange={() => setStatus("OK")} />
                        <CheckCircle className="h-5 w-5" />
                        <span className="text-xs font-medium">OK</span>
                    </label>

                    <label className={clsx(
                        "flex-1 cursor-pointer border rounded-md p-2 flex flex-col items-center gap-1 transition-all",
                        status === "Warning" ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-500" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}>
                        <input type="radio" name={`status-${device.id}`} value="Warning" className="sr-only" checked={status === "Warning"} onChange={() => setStatus("Warning")} />
                        <AlertTriangle className="h-5 w-5" />
                        <span className="text-xs font-medium">Warning</span>
                    </label>

                    <label className={clsx(
                        "flex-1 cursor-pointer border rounded-md p-2 flex flex-col items-center gap-1 transition-all",
                        status === "Error" ? "bg-red-50 dark:bg-red-900/20 border-red-500 text-red-700 dark:text-red-400 ring-1 ring-red-500" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}>
                        <input type="radio" name={`status-${device.id}`} value="Error" className="sr-only" checked={status === "Error"} onChange={() => setStatus("Error")} />
                        <XCircle className="h-5 w-5" />
                        <span className="text-xs font-medium">Error</span>
                    </label>
                </div>

                {/* Remarks & Photo */}
                <div className="md:flex-1 w-full space-y-3">
                    <textarea
                        name={`remarks-${device.id}`}
                        placeholder="Remarks (optional)"
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />

                    {(status === "Warning" || status === "Error") && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                            <Upload className="h-4 w-4" />
                            <input
                                type="file"
                                name={`photo-${device.id}`}
                                accept="image/*"
                                className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/20 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/30"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
