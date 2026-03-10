"use client";

import { Trash2, Edit, Search, Filter, X, ArrowUpDown, ArrowUp, ArrowDown, Network, Power, PackageOpen, MonitorPlay, Globe, Terminal, Phone, Shield } from "lucide-react";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import EditDeviceForm from "./edit-device-form";
import DeleteDeviceModal from "./delete-device-modal";
import PrintQRModal from "./print-qr-modal";
import { QrCode } from "lucide-react";
import { toggleDeviceStatus, takeoutFromRack } from "@/actions/master-data";
import PhotoModalTrigger from "@/components/report/photo-modal-trigger";

type Device = {
    id: number;
    name: string;
    brandId: number | null;
    brandName: string | null;
    brandLogo: string | null;
    categoryName: string | null;
    locationId: number | null;
    locationName: string | null;
    photoPath: string | null;
    rackName: string | null;
    rackPosition: number | null;
    uHeight: number | null;
    zone: string | null;
    categoryId: number;
    ipAddress: string | null;
    description: string | null;
    isActive: boolean | null;
};

type Brand = {
    id: number;
    name: string;
    logoPath: string | null;
    createdAt: Date | null;
};

type Location = {
    id: number;
    name: string;
};

export default function DeviceTable({ devices, brands, locations }: { devices: Device[], brands: Brand[], locations: Location[] }) {
    const [editingDevice, setEditingDevice] = useState<Device | null>(null);
    const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);
    const [printingDevice, setPrintingDevice] = useState<Device | null>(null);
    const [manageDevice, setManageDevice] = useState<Device | null>(null);
    const [customPort, setCustomPort] = useState("");
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleDeleteSuccess = () => {
        setDeletingDevice(null);
        router.refresh();
    };

    const handleToggleStatus = (deviceId: number) => {
        startTransition(async () => {
            const res = await toggleDeviceStatus(deviceId);
            if (!res.success) alert(res.message);
        });
    };

    const handleTakeout = (device: Device) => {
        if (!confirm(`Take out "${device.name}" from ${device.rackName} U${device.rackPosition}? This will clear its rack position.`)) return;
        startTransition(async () => {
            const res = await takeoutFromRack(device.id);
            if (!res.success) alert(res.message);
        });
    };

    // Sort states
    type SortConfig = { key: keyof Device, direction: 'asc' | 'desc' } | null;
    const [sortConfig, setSortConfig] = useState<SortConfig>(null);

    const handleSort = (key: keyof Device) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key: keyof Device) => {
        if (!sortConfig || sortConfig.key !== key) {
            return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-0 group-hover:opacity-50 transition-opacity text-slate-600" />;
        }
        return sortConfig.direction === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 ml-1 text-blue-400" />
            : <ArrowDown className="h-3.5 w-3.5 ml-1 text-blue-400" />;
    };

    // Filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedBrand, setSelectedBrand] = useState("");
    const [selectedRack, setSelectedRack] = useState("");
    const [selectedStatus, setSelectedStatus] = useState("");

    // Compute unique options from devices
    const uniqueCategories = Array.from(new Set(devices.map(d => d.categoryName).filter(Boolean))).sort() as string[];
    const uniqueBrands = Array.from(new Set(devices.map(d => d.brandName).filter(Boolean))).sort() as string[];
    const uniqueRacks = Array.from(new Set(devices.map(d => d.rackName).filter(Boolean))).sort() as string[];

    // Apply filters
    const filteredDevices = devices.filter(device => {
        const matchesSearch = !searchQuery ||
            device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (device.ipAddress && device.ipAddress.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesCategory = !selectedCategory || device.categoryName === selectedCategory;
        const matchesBrand = !selectedBrand || device.brandName === selectedBrand;
        const matchesRack = !selectedRack || device.rackName === selectedRack;
        const matchesStatus = !selectedStatus ||
            (selectedStatus === "active" && device.isActive !== false) ||
            (selectedStatus === "inactive" && device.isActive === false);

        return matchesSearch && matchesCategory && matchesBrand && matchesRack && matchesStatus;
    });

    // Apply sorting
    const sortedDevices = [...filteredDevices].sort((a, b) => {
        if (!sortConfig) return 0;

        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const resetFilters = () => {
        setSearchQuery("");
        setSelectedCategory("");
        setSelectedBrand("");
        setSelectedRack("");
        setSelectedStatus("");
        setSortConfig(null);
    };

    const hasFilters = searchQuery || selectedCategory || selectedBrand || selectedRack || selectedStatus;

    return (
        <div className="space-y-4">
            {/* Filter Toolbar */}
            {devices.length > 0 && (
                <div className="glow-card p-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search by device name or IP address..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-9 pl-9 pr-8 text-sm rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="flex w-full xl:w-auto gap-2.5 overflow-x-auto pb-1 xl:pb-0 items-center no-scrollbar">
                        <div className="flex items-center gap-1.5 text-slate-500 text-xs whitespace-nowrap">
                            <Filter className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Filters:</span>
                        </div>

                        <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:ring-1 focus:ring-blue-500 min-w-[130px]">
                            <option value="">All Categories</option>
                            {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>

                        <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:ring-1 focus:ring-blue-500 min-w-[130px]">
                            <option value="">All Brands</option>
                            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>

                        <select value={selectedRack} onChange={(e) => setSelectedRack(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:ring-1 focus:ring-blue-500 min-w-[130px]">
                            <option value="">All Racks</option>
                            {uniqueRacks.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>

                        <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:ring-1 focus:ring-blue-500 min-w-[120px]">
                            <option value="">All Status</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>

                        {hasFilters && (
                            <button onClick={resetFilters} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 whitespace-nowrap">
                                <X className="h-3 w-3" /> Reset
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className="glow-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-[#0d1526] text-[11px] uppercase tracking-wider text-slate-500">
                            <tr>
                                <th className="px-5 py-3 text-left">
                                    <button onClick={() => handleSort('name')} className="flex items-center group focus:outline-none">
                                        Device Name {getSortIcon('name')}
                                    </button>
                                </th>
                                <th className="px-5 py-3 text-left">
                                    <button onClick={() => handleSort('brandName')} className="flex items-center group focus:outline-none">
                                        Brand {getSortIcon('brandName')}
                                    </button>
                                </th>
                                <th className="px-5 py-3 text-left">
                                    <button onClick={() => handleSort('categoryName')} className="flex items-center group focus:outline-none">
                                        Category {getSortIcon('categoryName')}
                                    </button>
                                </th>
                                <th className="px-5 py-3 text-left">
                                    <button onClick={() => handleSort('locationName')} className="flex items-center group focus:outline-none">
                                        Location {getSortIcon('locationName')}
                                    </button>
                                </th>
                                <th className="px-5 py-3 text-left">
                                    <button onClick={() => handleSort('rackName')} className="flex items-center group focus:outline-none">
                                        Rack {getSortIcon('rackName')}
                                    </button>
                                </th>
                                <th className="px-5 py-3 text-left">
                                    <button onClick={() => handleSort('ipAddress')} className="flex items-center group focus:outline-none">
                                        IP Address {getSortIcon('ipAddress')}
                                    </button>
                                </th>
                                <th className="px-5 py-3 text-center">Status</th>
                                <th className="px-5 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {sortedDevices.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                                        {devices.length === 0
                                            ? "No devices found. Add one above."
                                            : "No devices match your search and filter criteria."}
                                    </td>
                                </tr>
                            ) : (() => {
                                // Group devices by Rack
                                const groups: { [key: string]: Device[] } = {};
                                sortedDevices.forEach(d => {
                                    const r = d.rackName || "Unassigned / Direct Placement";
                                    if (!groups[r]) groups[r] = [];
                                    groups[r].push(d);
                                });

                                return Object.entries(groups).map(([rackName, rackDevices]) => (
                                    <React.Fragment key={rackName}>
                                        {/* Rack Header Row */}
                                        <tr className="bg-slate-800/30 border-y border-slate-700/50 group/rack">
                                            <td colSpan={8} className="px-5 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="size-6 rounded bg-blue-500/20 flex items-center justify-center">
                                                        <span className="material-symbols-outlined text-blue-400 text-sm">view_in_ar</span>
                                                    </div>
                                                    <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                                                        {rackName}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 font-medium">
                                                        ({rackDevices.length} devices)
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>

                                        {rackDevices.map((device) => {
                                            const isActive = device.isActive !== false;
                                            const isInRack = !!device.rackName;
                                            const showTakeout = !isActive && isInRack;

                                            return (
                                                <tr key={device.id} className={`transition-colors ${isActive ? "hover:bg-slate-800/30" : "hover:bg-slate-800/20 opacity-60"}`}>
                                                    <td className="px-5 py-3 whitespace-nowrap font-medium text-white">
                                                        <div className="flex items-center gap-2">
                                                            {!isActive && (
                                                                <span className="size-2 rounded-full bg-red-500 shrink-0" title="Inactive" />
                                                            )}
                                                            <span className={!isActive ? "line-through text-slate-400" : ""}>{device.name}</span>
                                                            {device.photoPath && (
                                                                <PhotoModalTrigger photoPath={device.photoPath} deviceName={device.name} />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-white">
                                                        {device.brandLogo ? (
                                                            <div className="flex items-center gap-2">
                                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                <img src={device.brandLogo} alt={device.brandName || "Brand"} className="h-5 w-auto object-contain bg-white rounded p-0.5" />
                                                                <span className="text-slate-300">{device.brandName}</span>
                                                            </div>
                                                        ) : device.brandName ? (
                                                            <span className="text-slate-300">{device.brandName}</span>
                                                        ) : (
                                                            <span className="text-slate-600">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-slate-400">{device.categoryName}</td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-slate-400">{device.locationName || "-"}</td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-slate-400">
                                                        {device.rackName ? (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-mono bg-slate-700/50 border border-slate-600/50 px-2 py-0.5 rounded">
                                                                    U{device.rackPosition}
                                                                </span>
                                                                {showTakeout && (
                                                                    <button
                                                                        onClick={() => handleTakeout(device)}
                                                                        disabled={isPending}
                                                                        className="text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                                                                        title="Take out from rack"
                                                                    >
                                                                        <PackageOpen className="h-4 w-4" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-600">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-slate-400">
                                                        {device.ipAddress ? (
                                                            <span className="font-mono text-xs bg-slate-700/50 border border-slate-600/50 px-2 py-0.5 rounded">{device.ipAddress}</span>
                                                        ) : (
                                                            <span className="text-slate-600">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-center">
                                                        <button
                                                            onClick={() => handleToggleStatus(device.id)}
                                                            disabled={isPending}
                                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer disabled:opacity-50 ${isActive
                                                                ? "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                                                                : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                                                                }`}
                                                            title={`Click to ${isActive ? "deactivate" : "activate"}`}
                                                        >
                                                            <Power className="h-3 w-3" />
                                                            {isActive ? "Active" : "Inactive"}
                                                        </button>
                                                    </td>
                                                    <td className="px-5 py-3 whitespace-nowrap text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            {device.ipAddress && (
                                                                <button onClick={() => setManageDevice(device)} className="p-1.5 rounded-lg hover:bg-slate-700 text-indigo-400 transition-colors" title="Manage Device (Remote)">
                                                                    <MonitorPlay className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                            <Link
                                                                href={`/admin/devices/${device.id}/network`}
                                                                className="p-1.5 rounded-lg hover:bg-slate-700 text-teal-400 transition-colors"
                                                                title="Network Ports"
                                                            >
                                                                <Network className="h-4 w-4" />
                                                            </Link>
                                                            <button onClick={() => setPrintingDevice(device)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 transition-colors" title="Print QR">
                                                                <QrCode className="h-4 w-4" />
                                                            </button>
                                                            <button onClick={() => setEditingDevice(device)} className="p-1.5 rounded-lg hover:bg-slate-700 text-blue-400 transition-colors" title="Edit">
                                                                <Edit className="h-4 w-4" />
                                                            </button>
                                                            <button onClick={() => setDeletingDevice(device)} className="p-1.5 rounded-lg hover:bg-slate-700 text-red-400 transition-colors" title="Delete">
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ));
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>

            {editingDevice && (
                <EditDeviceForm
                    device={editingDevice}
                    onClose={() => setEditingDevice(null)}
                    brands={brands}
                    locations={locations}
                />
            )}

            {deletingDevice && (
                <DeleteDeviceModal
                    deviceId={deletingDevice.id}
                    deviceName={deletingDevice.name}
                    onClose={() => setDeletingDevice(null)}
                    onSuccess={handleDeleteSuccess}
                />
            )}

            {printingDevice && (
                <PrintQRModal
                    deviceId={printingDevice.id}
                    deviceName={printingDevice.name}
                    onClose={() => setPrintingDevice(null)}
                />
            )}

            {manageDevice && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setManageDevice(null); setCustomPort(""); }}>
                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                            <div>
                                <h3 className="text-lg font-bold text-white">Manage Device</h3>
                                <p className="text-xs text-slate-400 mt-0.5">{manageDevice.name} ({manageDevice.ipAddress})</p>
                            </div>
                            <button onClick={() => { setManageDevice(null); setCustomPort(""); }} className="text-slate-500 hover:text-white bg-slate-800 p-1.5 rounded-lg transition-colors border border-slate-700">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">Custom Port (Optional)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. 8080 or 2222"
                                    value={customPort}
                                    onChange={(e) => setCustomPort(e.target.value)}
                                    className="w-full h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <a href={`http://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ''}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-800 hover:bg-blue-500/10 border border-slate-700 hover:border-blue-500/50 text-slate-300 hover:text-blue-400 transition-all cursor-pointer">
                                    <Globe className="h-6 w-6" />
                                    <span className="text-[11px] uppercase tracking-wider font-bold mt-1">HTTP Web</span>
                                </a>
                                <a href={`https://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ''}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-800 hover:bg-green-500/10 border border-slate-700 hover:border-green-500/50 text-slate-300 hover:text-green-400 transition-all cursor-pointer">
                                    <Shield className="h-6 w-6" />
                                    <span className="text-[11px] uppercase tracking-wider font-bold mt-1">HTTPS Web</span>
                                </a>
                                <a href={`ssh://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ''}`} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-800 hover:bg-purple-500/10 border border-slate-700 hover:border-purple-500/50 text-slate-300 hover:text-purple-400 transition-all cursor-pointer">
                                    <Terminal className="h-6 w-6" />
                                    <span className="text-[11px] uppercase tracking-wider font-bold mt-1">SSH Access</span>
                                </a>
                                <a href={`telnet://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ''}`} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-800 hover:bg-orange-500/10 border border-slate-700 hover:border-orange-500/50 text-slate-300 hover:text-orange-400 transition-all cursor-pointer">
                                    <Phone className="h-6 w-6" />
                                    <span className="text-[11px] uppercase tracking-wider font-bold mt-1">Telnet Protocol</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
