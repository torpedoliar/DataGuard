"use client";

import { useState, useEffect } from "react";
import type { RackData, RackDevice } from "@/actions/rack-layout";
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/core";
import { Server, Network, Zap, Wind, XCircle, AlertTriangle, Search, Filter, X, MapPin } from "lucide-react";

interface RackLayoutProps {
    racks: RackData[];
    categories: {
        id: number;
        name: string;
        color: string | null;
    }[];
}

const renderCategoryIcon = (categoryName: string | null, className?: string) => {
    if (!categoryName) return <Server className={className} />;
    const name = categoryName.toLowerCase();
    if (name.includes("network")) return <Network className={className} />;
    if (name.includes("ups") || name.includes("power")) return <Zap className={className} />;
    if (name.includes("crac") || name.includes("ac") || name.includes("cool")) return <Wind className={className} />;
    return <Server className={className} />;
};

function DroppableSlot({ u, rackName, gridRow }: { u: number; rackName: string; gridRow: number }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `slot-${rackName}-${u}`,
        data: { rackName, position: u, type: "slot" },
    });

    return (
        <div
            ref={setNodeRef}
            id={`slot-${rackName}-${u}`}
            className={`transition-all ${isOver ? "bg-white/[0.08]" : ""}`}
            style={{ gridRow }}
            data-rack-name={rackName}
            data-position={u}
        />
    );
}

function DraggableDevice({ device, categoryName, gridRow, isMuted, onSelect }: { device: RackDevice & { isMuted?: boolean }; categoryName: string | null; gridRow: number; isMuted?: boolean; onSelect?: (device: RackDevice) => void }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `device-${device.id}`,
        data: { deviceId: device.id, deviceName: device.name, rackName: device.rackName, uHeight: device.uHeight || 1, type: "device" },
    });

    const uHeight = device.uHeight || 1;
    const colorHex = device.categoryColor || "#64748b";
    const isSmall = uHeight <= 1;

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 999 : 10,
        opacity: isDragging ? 0.4 : (isMuted ? 0.12 : 1),
        gridRow: `${gridRow} / span ${uHeight}`,
    } : {
        gridRow: `${gridRow} / span ${uHeight}`,
        opacity: isMuted ? 0.12 : 1,
        transition: "opacity 0.2s ease",
        zIndex: 10,
    };

    return (
        <div
            ref={setNodeRef}
            id={`device-${device.id}`}
            className="relative group cursor-grab active:cursor-grabbing w-full"
            style={style}
            onClick={() => onSelect?.(device)}
            {...listeners}
            {...attributes}
        >
            {/* Server blade — colored card with depth */}
            <div
                className="h-full rounded-sm overflow-hidden border border-white/[0.06]"
                style={{
                    background: colorHex,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.4)`,
                }}
            >
                {/* Top highlight line */}
                <div className="h-[1px] bg-white/20" />

                <div className={`flex items-center gap-1.5 ${isSmall ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}>
                    <div className="shrink-0 text-white/70">
                        {renderCategoryIcon(categoryName, isSmall ? "h-3 w-3" : "h-3.5 w-3.5")}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className={`font-semibold text-white truncate leading-tight ${isSmall ? 'text-[10px]' : 'text-[11px]'}`}>
                            {device.name}
                        </div>
                        {device.brandName && (
                            <div className={`flex items-center gap-1 text-white/60 truncate leading-tight ${isSmall ? 'text-[8px]' : 'text-[9px]'}`}>
                                {device.brandLogo && (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={device.brandLogo} alt={device.brandName} className="h-2 w-auto object-contain rounded-[1px]" />
                                )}
                                <span className="truncate">{device.brandName}</span>
                            </div>
                        )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                        {device.status === "Error" && (
                            <div className="flex items-center gap-0.5 text-[8px] font-bold text-red-200 bg-red-950/70 px-1 py-0.3 rounded">
                                <XCircle className="h-2.5 w-2.5" />
                            </div>
                        )}
                        {device.status === "Warning" && (
                            <div className="flex items-center gap-0.5 text-[8px] font-bold text-amber-200 bg-amber-950/70 px-1 py-0.3 rounded">
                                <AlertTriangle className="h-2.5 w-2.5" />
                            </div>
                        )}
                        <span className="text-[8px] font-mono text-white/50 bg-black/20 px-1 rounded">{uHeight}U</span>
                    </div>
                    <div className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity">
                        <svg width="10" height="12" viewBox="0 0 10 12" fill="white" className="shrink-0">
                            <circle cx="2" cy="2" r="1" />
                            <circle cx="8" cy="2" r="1" />
                            <circle cx="2" cy="6" r="1" />
                            <circle cx="8" cy="6" r="1" />
                            <circle cx="2" cy="10" r="1" />
                            <circle cx="8" cy="10" r="1" />
                        </svg>
                    </div>
                </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none bg-black/50 rounded-sm">
                <span className="text-[9px] font-medium text-white">Drag to move</span>
            </div>
        </div>
    );
}

export default function RackLayout({ racks, categories }: RackLayoutProps) {
    const [selectedDevice, setSelectedDevice] = useState<RackDevice | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isClient, setIsClient] = useState(false);

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedZone, setSelectedZone] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedStatus, setSelectedStatus] = useState("");
    const [selectedLocation, setSelectedLocation] = useState("");

    const uniqueZones = Array.from(new Set(racks.map(r => r.zone).filter(Boolean))).sort() as string[];
    const uniqueLocations = Array.from(new Set(racks.map(r => r.locationName).filter(Boolean))).sort() as string[];

    useEffect(() => { setIsClient(true); }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setIsDragging(false);
        if (!over) return;
        const deviceId = Number(active.data.current?.deviceId);
        if (!deviceId) return;
        const targetRack = over.data.current?.rackName as string | undefined;
        const targetPosition = over.data.current?.position as number | undefined;
        if (!targetRack || !targetPosition) return;

        try {
            const response = await fetch("/admin/rack/api/update-position", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceId, rackName: targetRack, rackPosition: targetPosition }),
            });
            if (response.ok) { window.location.reload(); }
            else { const error = await response.json(); alert(`Failed to move device: ${error.error}`); }
        } catch { alert("Failed to move device. Please try again."); }
    };

    const processedRacks = racks.map(rack => {
        const processedDevices = rack.devices.map(device => {
            const matchesSearch = !searchQuery ||
                device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (device.brandName && device.brandName.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesCategory = !selectedCategory || device.categoryName === selectedCategory;
            const matchesStatus = !selectedStatus || device.status === selectedStatus;
            const isMatch = matchesSearch && matchesCategory && matchesStatus;
            return { ...device, isMuted: !isMatch && !!(searchQuery || selectedCategory || selectedStatus || selectedZone) };
        });
        const matchesZone = !selectedZone || rack.zone === selectedZone;
        const matchesLocation = !selectedLocation || rack.locationName === selectedLocation;
        const rackNameMatches = !searchQuery || rack.name.toLowerCase().includes(searchQuery.toLowerCase());
        const hasMatchingDevices = processedDevices.some(d => !d.isMuted);
        const hasFiltersActive = !!(searchQuery || selectedCategory || selectedStatus || selectedZone || selectedLocation);
        const shouldShow = !hasFiltersActive || (matchesZone && matchesLocation && (rackNameMatches || hasMatchingDevices));
        return { ...rack, devices: processedDevices, shouldShow, hasMatchingDevices };
    }).filter(r => r.shouldShow);

    const groupedRacks = processedRacks.reduce((groups, rack) => {
        const loc = rack.locationName || "Unassigned Location";
        if (!groups[loc]) groups[loc] = [];
        groups[loc].push(rack);
        return groups;
    }, {} as Record<string, typeof processedRacks>);

    const renderRackSlots = (rack: RackData & { devices: (RackDevice & { isMuted?: boolean })[] }) => {
        const slots: React.ReactNode[] = [];
        const totalU = rack.totalU || 42;
        for (let u = totalU; u >= 1; u--) {
            const row = totalU - u + 1;
            const device = rack.devices.find((d) => d.rackPosition === u);
            const isOccupiedInfo = rack.devices.find(d =>
                d.rackPosition !== null && u >= d.rackPosition && u < d.rackPosition + (d.uHeight || 1)
            );

            if (device) {
                const uHeight = device.uHeight || 1;
                const topRow = totalU - (u + uHeight - 1) + 1;
                const isMuted = "isMuted" in device && device.isMuted === true;
                slots.push(
                    <DraggableDevice key={`device-${device.id}`} device={device} categoryName={device.categoryName} gridRow={topRow} isMuted={isMuted} onSelect={setSelectedDevice} />
                );
            }
            slots.push(
                <DroppableSlot key={`slot-${rack.name}-${u}`} u={u} rackName={rack.name} gridRow={row} />
            );
        }
        return slots;
    };

    const resetFilters = () => {
        setSearchQuery(""); setSelectedCategory(""); setSelectedZone(""); setSelectedStatus(""); setSelectedLocation("");
    };
    const hasFilters = searchQuery || selectedCategory || selectedZone || selectedStatus || selectedLocation;

    if (racks.length === 0) {
        return (
            <div className="text-center py-12 text-ops-muted">
                <Server className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-ops-text">No rack data available</p>
                <p className="text-sm mt-2">Add devices with rack positions to see the layout</p>
            </div>
        );
    }

    if (!isClient) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {racks.map((rack) => (
                    <div key={`${rack.name}-${rack.zone || 'no-zone'}`} className="rounded-xl border border-ops-border bg-ops-surface shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-ops-border">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-base text-ops-text">{rack.name}</h3>
                                    <p className="text-xs text-ops-muted">{rack.zone || "Unassigned"} • {rack.devices.length} devices</p>
                                </div>
                                <div className="text-right text-xs text-ops-muted">
                                    <div>Occupancy</div>
                                    <div className="font-bold text-ops-text">{rack.occupiedU.length}U / {rack.totalU}U</div>
                                </div>
                            </div>
                        </div>
                        <div className="px-4 py-8 text-center text-sm text-ops-muted">Loading rack layout...</div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
        >
            <div className="space-y-6">

                {/* ── Search & Filter Toolbar ── */}
                <div className="rounded-xl border border-ops-border bg-ops-surface shadow-sm p-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ops-muted" />
                        <input
                            type="text"
                            placeholder="Search device, brand, or rack…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-9 pl-9 pr-8 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text placeholder:text-ops-muted focus:ring-1 focus:ring-ops-accent focus:border-ops-accent outline-none transition-all"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ops-muted hover:text-ops-text">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="flex w-full xl:w-auto gap-2 overflow-x-auto pb-1 xl:pb-0 items-center no-scrollbar">
                        <div className="flex items-center gap-1.5 text-ops-muted text-xs whitespace-nowrap shrink-0">
                            <Filter className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Filter:</span>
                        </div>
                        <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text outline-none focus:ring-1 focus:ring-ops-accent min-w-[120px]">
                            <option value="">All Zones</option>
                            {uniqueZones.map(z => <option key={z} value={z}>{z}</option>)}
                        </select>
                        <select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text outline-none focus:ring-1 focus:ring-ops-accent min-w-[120px]">
                            <option value="">All Locations</option>
                            {uniqueLocations.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text outline-none focus:ring-1 focus:ring-ops-accent min-w-[120px]">
                            <option value="">All Categories</option>
                            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
                            className="h-9 px-3 text-sm rounded-lg bg-ops-bg border border-ops-border text-ops-text outline-none focus:ring-1 focus:ring-ops-accent min-w-[110px]">
                            <option value="">All Status</option>
                            <option value="OK">OK</option>
                            <option value="Warning">Warning</option>
                            <option value="Error">Error</option>
                            <option value="Pending">Pending</option>
                        </select>
                        {hasFilters && (
                            <button onClick={resetFilters} className="h-9 px-3 text-sm text-ops-muted hover:text-ops-text flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-ops-border hover:border-ops-muted transition-colors">
                                <X className="h-3 w-3" /> Reset
                            </button>
                        )}
                    </div>
                </div>

                {/* ── Legend ── */}
                <div className="rounded-xl border border-ops-border bg-ops-surface shadow-sm p-4">
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {categories.map((cat) => (
                            <div key={cat.id} className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-sm shadow-sm ring-1 ring-black/5" style={{ backgroundColor: cat.color || "#3b82f6" }}></div>
                                <span className="text-xs text-ops-muted">{cat.name}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Device Detail Modal ── */}
                {selectedDevice && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedDevice(null)}>
                        <div className="bg-ops-surface rounded-xl shadow-xl max-w-md w-full p-6 border border-ops-border" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-ops-text">Device Details</h3>
                                <button onClick={() => setSelectedDevice(null)} className="text-ops-muted hover:text-ops-text">
                                    <XCircle className="h-5 w-5" />
                                </button>
                            </div>
                            {selectedDevice.photoPath && (
                                <div className="mb-4">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={selectedDevice.photoPath} alt={selectedDevice.name} className="w-full h-40 object-cover rounded-lg border border-ops-border" />
                                </div>
                            )}
                            <div className="space-y-3">
                                {[
                                    ["Name", selectedDevice.name],
                                    ["Brand", selectedDevice.brandName || "-"],
                                    ["Category", selectedDevice.categoryName],
                                    ["Location", selectedDevice.locationName || "-"],
                                    ["Rack", selectedDevice.rackName],
                                    ["Position", `U${selectedDevice.rackPosition}`],
                                    ["Zone", selectedDevice.zone || "-"],
                                ].map(([label, value]) => (
                                    <div key={label}>
                                        <label className="text-xs text-ops-muted">{label}</label>
                                        <p className="font-medium text-ops-text">{value}</p>
                                    </div>
                                ))}
                                <div>
                                    <label className="text-xs text-ops-muted">Status</label>
                                    <p className={`font-medium ${
                                        selectedDevice.status === 'Error' ? 'text-ops-danger' :
                                        selectedDevice.status === 'Warning' ? 'text-ops-warning' :
                                        selectedDevice.status === 'OK' ? 'text-ops-success' : 'text-ops-muted'
                                    }`}>
                                        {selectedDevice.status || "Pending"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {hasFilters && processedRacks.length === 0 && (
                    <div className="text-center py-12 text-ops-muted">
                        <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium text-ops-text">No racks or devices match your filters</p>
                        <button onClick={resetFilters} className="mt-4 text-ops-accent hover:text-ops-text text-sm">Clear all filters</button>
                    </div>
                )}

                {/* ── Rack Cards ── */}
                <div className="space-y-10">
                    {Object.entries(groupedRacks).sort().map(([location, racksInLocation]) => (
                        <div key={location} className="space-y-4">
                            <div className="flex items-center gap-2.5">
                                <MapPin className="h-5 w-5 text-ops-accent" />
                                <h3 className="text-base font-bold text-ops-text uppercase tracking-wider">{location}</h3>
                                <span className="ml-auto text-xs font-medium text-ops-muted bg-ops-bg px-2.5 py-1 rounded-full border border-ops-border">
                                    {racksInLocation.length} rack{racksInLocation.length > 1 ? "s" : ""}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {racksInLocation.map((rack) => {
                                    const totalU = rack.totalU || 42;
                                    const occupiedCount = rack.occupiedU.length;
                                    const freeU = totalU - occupiedCount;
                                    const pct = Math.round((occupiedCount / totalU) * 100);
                                    const barColor = pct > 90 ? "from-red-500 to-red-400" :
                                        pct > 70 ? "from-ops-warning to-amber-400" :
                                        pct > 40 ? "from-blue-500 to-cyan-400" :
                                        "from-emerald-500 to-green-400";

                                    return (
                                        <div
                                            key={`${rack.name}-${rack.zone || 'no-zone'}`}
                                            className={`group rounded-xl border overflow-hidden transition-all hover:shadow-lg ${
                                                isDragging ? "border-dashed border-2 border-ops-accent/40" : "border-ops-border bg-ops-surface shadow-sm"
                                            }`}
                                        >
                                            {/* ── Rack Header ── */}
                                            <div className="px-4 py-3 border-b border-ops-border flex items-center justify-between bg-ops-surface-raised">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <Server className="h-4 w-4 text-ops-accent shrink-0" />
                                                        <h3 className="font-bold text-sm truncate text-ops-text">{rack.name}</h3>
                                                    </div>
                                                    <p className="text-xs text-ops-muted mt-0.5 pl-6">
                                                        {rack.zone || "Unassigned"} • {rack.devices.length} devices
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0 ml-3">
                                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ops-muted">Occupancy</div>
                                                    <div className="text-lg font-bold leading-tight text-ops-text">
                                                        {occupiedCount}<span className="text-xs text-ops-muted font-normal">/{totalU}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ── Occupancy bar ── */}
                                            <div className="px-4 pt-3">
                                                <div className="h-1.5 bg-ops-bg rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* ── Rack Body — 3D chassis ── */}
                                            <div className="px-2 py-1.5 rack-chassis">
                                                <div className="flex h-full">
                                                    <div className="rack-rail rack-rail-left" />

                                                    <div className="flex-1 grid gap-0 rack-device-grid">
                                                        {/* U labels — every U line + big number every 10U */}
                                                        {Array.from({ length: totalU }, (_, i) => {
                                                            const u = totalU - i;
                                                            const row = i + 1;
                                                            const isMark = u % 10 === 0;
                                                            return (
                                                                <div
                                                                    key={`u-row-${u}`}
                                                                    className="relative flex items-center pr-1.5 text-right"
                                                                    style={{ gridRow: row }}
                                                                >
                                                                    {isMark ? (
                                                                        <span className="text-[10px] font-bold text-rack-label opacity-75">{u}</span>
                                                                    ) : (
                                                                        <div className="absolute right-0 w-1.5 border-t border-rack-line" />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                        {renderRackSlots(rack)}
                                                    </div>

                                                    <div className="rack-rail rack-rail-right" />
                                                </div>
                                            </div>

                                            {/* ── Rack Footer ── */}
                                            <div className="px-4 py-2 border-t border-ops-border bg-ops-bg flex items-center justify-between text-[10px] font-medium text-ops-muted">
                                                <span>{freeU}U free</span>
                                                <span className={`font-bold ${
                                                    pct > 90 ? 'text-ops-danger' :
                                                    pct > 70 ? 'text-ops-warning' :
                                                    'text-ops-success'
                                                }`}>
                                                    {pct}%
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </DndContext>
    );
}
