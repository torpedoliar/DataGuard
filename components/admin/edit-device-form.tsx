"use client";

import { updateDevice, getCategories } from "@/actions/master-data";
import { getRacks, getOccupiedSlots } from "@/actions/rack-management";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Server } from "lucide-react";
import DeviceHealthTrend from "./device-health-trend";

type Category = {
    id: number;
    name: string;
};

type Brand = {
    id: number;
    name: string;
    logoPath: string | null;
    createdAt: Date | null;
};

type Device = {
    id: number;
    name: string;
    brandId: number | null;
    brandName: string | null;
    brandLogo: string | null;
    categoryId: number;
    locationId: number | null;
    locationName: string | null;
    photoPath: string | null;
    zone: string | null;
    rackName: string | null;
    rackPosition: number | null;
    uHeight: number | null;
    ipAddress: string | null;
    description: string | null;
};

type Location = {
    id: number;
    name: string;
};

interface EditDeviceFormProps {
    device: Device;
    onClose: () => void;
    brands: Brand[];
    locations: Location[];
}

type Rack = {
    id: number;
    name: string;
    zone: string | null;
    totalU: number | null;
    locationId: number | null;
    locationName: string | null;
};

export default function EditDeviceForm({ device, onClose, brands, locations }: EditDeviceFormProps) {
    const [categories, setCategories] = useState<Category[]>([]);
    const [racks, setRacks] = useState<Rack[]>([]);
    const [occupiedSlots, setOccupiedSlots] = useState<Record<number, string>>({});
    const [selectedCategory, setSelectedCategory] = useState<string>(device.categoryId?.toString() || "");
    const [selectedRack, setSelectedRack] = useState<string>(device.rackName || "");
    const [selectedPosition, setSelectedPosition] = useState<string>(device.rackPosition?.toString() || "");
    const [state, action, isPending] = useActionState(updateDevice, undefined);
    const router = useRouter();

    useEffect(() => {
        getCategories().then(setCategories);
        getRacks().then(setRacks);
    }, []);

    useEffect(() => {
        if (selectedRack) {
            getOccupiedSlots(selectedRack, device.id).then(setOccupiedSlots);
        } else {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setOccupiedSlots({});
        }
    }, [selectedRack, device.id]);

    const selectedRackData = racks.find(r => r.name === selectedRack);

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, onClose, router]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white dark:bg-card-dark rounded-lg shadow-xl max-w-2xl w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <Server className="h-5 w-5 text-primary" />
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Edit Device</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Form Content */}
                <form action={action} className="flex-1 overflow-y-auto p-6">
                    <input type="hidden" name="id" value={device.id} />

                    <div className="mb-8">
                        <DeviceHealthTrend deviceId={device.id} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-1">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Device Name *
                            </label>
                            <input
                                name="name"
                                defaultValue={device.name}
                                required
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="md:col-span-1">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Brand
                            </label>
                            <select
                                name="brandId"
                                defaultValue={device.brandId || ""}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">-- No Brand --</option>
                                {brands.map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Category *
                            </label>
                            <select
                                name="categoryId"
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                required
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Select category</option>
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Zone
                            </label>
                            <input
                                name="zone"
                                defaultValue={device.zone || ""}
                                placeholder="e.g. Zone A"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Location *
                            </label>
                            <select
                                name="locationId"
                                defaultValue={device.locationId?.toString() || ""}
                                required
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Select location</option>
                                {locations.map(loc => (
                                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Rack Position Fields */}
                        <div className="md:col-span-2 border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                                <Server className="h-4 w-4" />
                                Rack Position
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Rack Name
                                    </label>
                                    <select
                                        name="rackName"
                                        value={selectedRack}
                                        onChange={(e) => {
                                            setSelectedRack(e.target.value);
                                            setSelectedPosition(""); // Reset position when rack changes
                                        }}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">-- No Rack --</option>
                                        {racks.map((rack) => (
                                            <option key={rack.id} value={rack.name}>
                                                {rack.name} {rack.zone ? `(${rack.zone})` : ''} - {rack.totalU || 42}U
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        U Position
                                    </label>
                                    <select
                                        name="rackPosition"
                                        value={selectedPosition}
                                        onChange={(e) => setSelectedPosition(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        disabled={!selectedRack}
                                    >
                                        <option value="">-- Select U --</option>
                                        {selectedRackData && Array.from({ length: selectedRackData.totalU || 42 }, (_, i) => i + 1).map((u) => {
                                            const occupyingDevice = occupiedSlots[u];
                                            const isOccupied = !!occupyingDevice;
                                            return (
                                                <option key={u} value={u} disabled={isOccupied} className={isOccupied ? "text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800" : ""}>
                                                    U{u} {isOccupied ? `(Occupied by ${occupyingDevice})` : "(Available)"}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        U Height
                                    </label>
                                    <select
                                        name="uHeight"
                                        defaultValue={device.uHeight || 1}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="0.5">0.5U</option>
                                        <option value="1">1U</option>
                                        <option value="2">2U</option>
                                        <option value="3">3U</option>
                                        <option value="4">4U</option>
                                        <option value="5">5U</option>
                                        <option value="6">6U</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Device Photo */}
                        <div className="md:col-span-2 border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Device Photo
                            </label>
                            {device.photoPath && (
                                <div className="mb-3 flex items-start gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                    <img src={device.photoPath} alt="Current device photo" className="h-20 w-auto rounded object-cover" />
                                    <div className="flex flex-col gap-1">
                                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Current Photo</p>
                                        <label className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 cursor-pointer mt-1">
                                            <input type="checkbox" name="deletePhoto" className="rounded border-slate-300" />
                                            Remove this photo
                                        </label>
                                    </div>
                                </div>
                            )}
                            <input
                                type="file"
                                name="photo"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file && file.size > 10 * 1024 * 1024) {
                                        alert("Ukuran file maksimal 10MB");
                                        e.target.value = "";
                                    }
                                }}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/40 dark:file:text-blue-400"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                Uploading a new photo will replace the current one.
                            </p>
                        </div>
                    </div>

                    {/* IP Address & Description */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                IP Address
                            </label>
                            <input
                                name="ipAddress"
                                defaultValue={device.ipAddress || ""}
                                placeholder="e.g. 192.168.1.100"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Keterangan
                            </label>
                            <textarea
                                name="description"
                                rows={2}
                                defaultValue={device.description || ""}
                                placeholder="Catatan atau keterangan tambahan..."
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                        </div>
                    </div>

                    {state?.errors && (
                        <div className="mt-3 text-red-500 text-sm">
                            {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                                <p key={i}>{e}</p>
                            ))}
                        </div>
                    )}
                    {state?.message && !state.success && (
                        <div className="mt-3 text-red-500 text-sm">{state.message}</div>
                    )}

                    {/* Footer Actions */}
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
