"use client";

import { useState, useEffect } from "react";
import type { RackDevice } from "@/actions/rack-layout";
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/core";
import { Server, Network, Zap, Wind, XCircle, Search, MapPin } from "lucide-react";
import type { FilteredRack } from "@/lib/rack-filter";

interface RackLayoutProps {
    racks: FilteredRack[];
    hasFilters: boolean;
    onResetFilters: () => void;
    onSelectDevice: (device: RackDevice) => void;
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
            style={{ gridRow, gridColumn: 1 }}
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

    // Proportional sizing: 1U = compact, 2U+ = spacious
    const isTiny = uHeight === 1;
    const iconSize = isTiny ? "h-3.5 w-3.5" : "h-5 w-5";
    const textNameSize = isTiny ? "text-[10px]" : "text-xs";
    const textBrandSize = isTiny ? "text-[9px]" : "text-[10px]";
    const logoSize = isTiny ? "h-2" : "h-2.5";
    const padX = isTiny ? "px-1.5" : "px-2";
    const padY = isTiny ? "py-0.5" : "py-1";
    const auditIconSize = isTiny ? "h-3 w-3" : "h-3.5 w-3.5";

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 999 : 10,
        opacity: isDragging ? 0.4 : (isMuted ? 0.15 : 1),
        gridRow: `${gridRow} / span ${uHeight}`,
        gridColumn: 1,
    } : {
        gridRow: `${gridRow} / span ${uHeight}`,
        gridColumn: 1,
        opacity: isMuted ? 0.15 : 1,
        transition: "opacity 0.2s ease",
        zIndex: 10,
    };

    return (
        <div
            ref={setNodeRef}
            id={`device-${device.id}`}
            className="relative w-full"
            style={style}
            onClick={() => onSelect?.(device)}
            {...listeners}
            {...attributes}
        >
            {/* Drag handle strip — left edge, always visible */}
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-sm bg-white/15 hover:bg-white/30 transition-colors z-10 cursor-grab active:cursor-grabbing" />

            {/* Server blade — colored card with depth */}
            <div
                className="h-full rounded-sm overflow-hidden border border-white/[0.06] rack-blade-dark"
                style={{
                    background: colorHex,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.4)`,
                }}
            >
                {/* Top highlight line */}
                <div className="h-[1px] bg-white/20" />

                <div className={`flex items-center gap-1.5 ${padX} ${padY}`}>
                    {/* Category icon — scales with U height */}
                    <div className="shrink-0 text-white/70">
                        {renderCategoryIcon(categoryName, iconSize)}
                    </div>

                    {/* Name + Brand */}
                    <div className="min-w-0 flex-1">
                        <div className={`font-semibold text-white truncate leading-tight ${textNameSize}`}>
                            {device.name}
                        </div>
                        {device.brandName && (
                            <div className={`flex items-center gap-1 text-white/60 truncate leading-tight ${textBrandSize}`}>
                                {device.brandLogo && (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={device.brandLogo} alt={device.brandName} className={`${logoSize} w-auto object-contain rounded-[1px] shrink-0`} />
                                )}
                                {!device.brandLogo && (
                                    <span className="text-white/30 shrink-0">◆</span>
                                )}
                                <span className="truncate">{device.brandName}</span>
                            </div>
                        )}
                    </div>

                    {/* Audit status + U height badge */}
                    <div className="shrink-0 flex items-center gap-1">
                        {device.status === "NOT OK" && (
                            <div className="flex items-center gap-0.5 text-[9px] font-bold text-red-200 bg-red-950/80 px-1.5 py-0.5 rounded">
                                <XCircle className={auditIconSize} />
                                <span className="hidden xl:inline">NOT OK</span>
                            </div>
                        )}
                        <span className="text-[8px] font-mono text-white/50 bg-black/20 px-1 rounded">{uHeight}U</span>
                        {/* Drag handle dots — always visible on device blade */}
                        <div className="shrink-0 flex items-center gap-0.5 opacity-50">
                            <svg width="8" height="10" viewBox="0 0 8 10" fill="white" className="shrink-0">
                                <circle cx="2" cy="2" r="1" />
                                <circle cx="6" cy="2" r="1" />
                                <circle cx="2" cy="5" r="1" />
                                <circle cx="6" cy="5" r="1" />
                                <circle cx="2" cy="8" r="1" />
                                <circle cx="6" cy="8" r="1" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function RackLayout({ racks, hasFilters, onResetFilters, onSelectDevice }: RackLayoutProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isClient, setIsClient] = useState(false);


    useEffect(() => { setIsClient(true); }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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

    const processedRacks = racks;

    const groupedRacks = processedRacks.reduce((groups, rack) => {
        const loc = rack.locationName || "Unassigned Location";
        if (!groups[loc]) groups[loc] = [];
        groups[loc].push(rack);
        return groups;
    }, {} as Record<string, typeof processedRacks>);

    const renderRackSlots = (rack: FilteredRack) => {
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
                const isMuted = device.isMuted;
                slots.push(
                    <DraggableDevice key={`device-${device.id}`} device={device} categoryName={device.categoryName} gridRow={topRow} isMuted={isMuted} onSelect={onSelectDevice} />
                );
            }
            slots.push(
                <DroppableSlot key={`slot-${rack.name}-${u}`} u={u} rackName={rack.name} gridRow={row} />
            );
        }
        return slots;
    };


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
                {hasFilters && processedRacks.length === 0 && (
                    <div className="text-center py-12 text-ops-muted">
                        <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium text-ops-text">No racks or devices match your filters</p>
                        <button onClick={onResetFilters} className="mt-4 text-ops-accent hover:text-ops-text text-sm">Clear all filters</button>
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
                                                                    style={{ gridRow: row, gridColumn: 1 }}
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
