
"use client";

import { addDevice } from "@/actions/master-data";
import { getRacks, getOccupiedSlots } from "@/actions/rack-management";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Server } from "lucide-react";

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

type Rack = {
    id: number;
    name: string;
    zone: string | null;
    totalU: number | null;
    locationId: number | null;
    locationName: string | null;
};

type Location = {
    id: number;
    name: string;
};

export default function AddDeviceForm({ categories, brands, locations }: { categories: Category[], brands: Brand[], locations: Location[] }) {
    const [state, action, isPending] = useActionState(addDevice, undefined);
    const [racks, setRacks] = useState<Rack[]>([]);
    const [selectedRack, setSelectedRack] = useState<string>("");
    const [occupiedSlots, setOccupiedSlots] = useState<Record<number, string>>({});
    const [zone, setZone] = useState<string>("");
    const [locationId, setLocationId] = useState<string>("");
    const router = useRouter();

    useEffect(() => {
        getRacks().then(setRacks);
    }, []);

    useEffect(() => {
        if (state?.success) {
            router.refresh();
        }
    }, [state?.success, router]);

    useEffect(() => {
        const rack = racks.find(r => r.name === selectedRack);
        if (rack) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            if (rack.zone) setZone(rack.zone);
            // eslint-disable-next-line react-hooks/set-state-in-effect
            if (rack.locationId) setLocationId(rack.locationId.toString());
            getOccupiedSlots(rack.name).then(setOccupiedSlots);
        } else {
            setZone("");
            setLocationId("");
            setOccupiedSlots({});
        }
    }, [selectedRack, racks]);

    const selectedRackData = racks.find(r => r.name === selectedRack);

    return (
        <div className="bg-white dark:bg-card-dark p-6 md:p-8 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-8">
            <div className="flex items-center gap-2 mb-4">
                <Server className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add New Device</h3>
            </div>

            <form action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Device Name *</label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Server APP-01"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Brand</label>
                    <select
                        name="brandId"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">-- No Brand --</option>
                        {brands.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category *</label>
                    <select
                        name="categoryId"
                        required
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Select category</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                {/* Rack Selection - Moved up for better UX */}
                <div className="lg:col-span-3 border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        Rack Selection (Optional)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Select Rack
                            </label>
                            <select
                                name="rackName"
                                value={selectedRack}
                                onChange={(e) => setSelectedRack(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">-- No Rack --</option>
                                {racks.map((rack) => (
                                    <option key={rack.id} value={rack.name}>
                                        {rack.name} {rack.zone ? `(${rack.zone})` : ''} - {rack.totalU || 42}U
                                    </option>
                                ))}
                            </select>
                            {racks.length === 0 && (
                                <p className="text-xs text-slate-500 mt-1">
                                    <a href="/admin/rack-manage" className="text-blue-600 hover:underline">
                                        Manage racks first
                                    </a>
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                U Position
                            </label>
                            <select
                                name="rackPosition"
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
                                defaultValue="1"
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

                {/* Zone and Location - Auto-populated from rack */}
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Location {selectedRack ? '(from rack)' : '*'}
                    </label>
                    <select
                        name="locationId"
                        required={!selectedRack}
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Select location</option>
                        {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Zone {selectedRack ? '(from rack)' : ''}
                    </label>
                    <input
                        name="zone"
                        value={zone}
                        onChange={(e) => setZone(e.target.value)}
                        placeholder={selectedRack ? "Auto-filled from rack" : "e.g. Zone A"}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* IP Address */}
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        IP Address
                    </label>
                    <input
                        name="ipAddress"
                        placeholder="e.g. 192.168.1.100"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                </div>

                {/* Device Photo Upload */}
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Device Photo
                    </label>
                    <input
                        type="file"
                        name="photo"
                        accept="image/*"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/40 dark:file:text-blue-400"
                    />
                </div>

                {/* Description / Keterangan */}
                <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Keterangan
                    </label>
                    <textarea
                        name="description"
                        rows={2}
                        placeholder="Catatan atau keterangan tambahan..."
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                </div>

                <div className="lg:col-span-3 flex justify-end">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center gap-2 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="h-5 w-5" /> Add Device</>}
                    </button>
                </div>
            </form>

            {state?.errors && (
                <div className="mt-3 text-red-500 text-sm">
                    {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => <p key={i}>{e}</p>)}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-red-500 text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-green-600 dark:text-green-400 text-sm">{state.message}</div>
            )}
        </div>
    );
}
