"use client";

import { useState, useEffect } from "react";
import type { RackData, RackDevice } from "@/actions/rack-layout";
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/core";
import { Server, Network, Zap, Wind, XCircle, AlertTriangle } from "lucide-react";

interface RackLayoutProps {
    racks: RackData[];
    categories: {
        id: number;
        name: string;
        color: string | null;
    }[];
}

// Helper functions
const renderCategoryIcon = (categoryName: string | null, className?: string) => {
    if (!categoryName) return <Server className={className} />;
    const name = categoryName.toLowerCase();
    if (name.includes("network")) return <Network className={className} />;
    if (name.includes("ups") || name.includes("power")) return <Zap className={className} />;
    if (name.includes("crac") || name.includes("ac") || name.includes("cool")) return <Wind className={className} />;
    return <Server className={className} />;
};

// Droppable Slot Component
function DroppableSlot({ u, rackName, isOccupied, gridRow }: { u: number; rackName: string; isOccupied: boolean; gridRow: number }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `slot-${rackName}-${u}`,
        data: {
            rackName,
            position: u,
            type: "slot",
        },
    });

    return (
        <div
            ref={setNodeRef}
            id={`slot-${rackName}-${u}`}
            className={`rounded-sm flex items-center justify-center text-[10px] transition-all ${isOccupied
                ? isOver ? "bg-red-500/20 border-red-400 border-solid" : "bg-slate-900/10 border-transparent"
                : isOver
                    ? "bg-blue-500/30 border-blue-400 border-solid border"
                    : "bg-slate-800/30 border-slate-700 hover:bg-slate-700/50 hover:border-slate-500 border border-dashed"
                }`}
            style={{ gridColumn: "2", gridRow }}
            data-rack-name={rackName}
            data-position={u}
        >
            {/* Show U number every 5U for reference on empty slots */}
            {!isOccupied && u % 5 === 0 && (
                <span className="text-slate-500 dark:text-slate-400 font-mono text-[9px]">{u}U</span>
            )}
        </div>
    );
}

// Draggable Device Component
function DraggableDevice({ device, categoryName, gridRow }: { device: RackDevice; categoryName: string | null; gridRow: number }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `device-${device.id}`,
        data: {
            deviceId: device.id,
            deviceName: device.name,
            rackName: device.rackName,
            uHeight: device.uHeight || 1,
            type: "device",
        },
    });

    const uHeight = device.uHeight || 1;

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 999 : 10,
        opacity: isDragging ? 0.5 : 1,
        gridColumn: "2",
        gridRow: `${gridRow} / span ${uHeight}`
    } : {
        gridColumn: "2",
        gridRow: `${gridRow} / span ${uHeight}`,
        zIndex: 10
    };

    const colorHex = device.categoryColor || "#64748b";

    return (
        <div
            ref={setNodeRef}
            id={`device-${device.id}`}
            className={`relative group cursor-grab active:cursor-grabbing h-full`}
            style={style}
            {...listeners}
            {...attributes}
        >
            <div
                className={`rounded-md ${uHeight > 1 ? 'p-2' : 'p-1 px-2'} text-white shadow-lg border-2 border-slate-600 hover:border-white transition-all hover:shadow-xl h-full flex flex-col justify-center overflow-hidden`}
                style={{ backgroundColor: colorHex }}
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className={`flex items-center gap-1 ${uHeight > 1 ? 'mb-1' : ''}`}>
                            {renderCategoryIcon(categoryName, "h-3 w-3 flex-shrink-0")}
                            <span className="text-xs font-bold truncate leading-none">{device.name}</span>
                        </div>
                        {device.brandName && (
                            <div className={`flex items-center gap-1 text-[10px] opacity-90 font-medium truncate ${uHeight === 1 ? 'mt-0.5' : ''} leading-none`}>
                                {device.brandLogo && (
                                    <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={device.brandLogo} alt={device.brandName} className="h-3 w-auto object-contain bg-white/80 rounded-[2px]" />
                                    </>
                                )}
                                <span>{device.brandName}</span>
                            </div>
                        )}
                        {uHeight > 1 && (
                            <div className="text-[10px] opacity-75 truncate mt-0.5 leading-none">
                                {categoryName}
                            </div>
                        )}
                    </div>
                    <div className={`flex flex-shrink-0 ${uHeight > 1 ? 'flex-col items-end' : 'flex-row items-center'} gap-1`}>
                        {device.status === "Error" && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-red-100 bg-red-900/80 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap" title="Status: Error">
                                <XCircle className="h-3 w-3" />
                                <span>Error</span>
                            </div>
                        )}
                        {device.status === "Warning" && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-100 bg-amber-900/80 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap" title="Status: Warning">
                                <AlertTriangle className="h-3 w-3" />
                                <span>Warning</span>
                            </div>
                        )}
                        <span className="text-[10px] font-mono bg-black/20 px-1 rounded whitespace-nowrap">
                            {uHeight}U
                        </span>
                    </div>
                </div>
                {/* Drag handle indicator */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded px-2 py-1 text-xs pointer-events-none">
                    Drag to move
                </div>
            </div>
        </div>
    );
}

export default function RackLayout({ racks, categories }: RackLayoutProps) {
    const [selectedDevice, setSelectedDevice] = useState<RackDevice | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isClient, setIsClient] = useState(false);

    // Ensure component only renders DndContext on client side
    useEffect(() => {
        setIsClient(true);
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setIsDragging(false);

        if (!over) return;

        const deviceId = Number(active.data.current?.deviceId);
        if (!deviceId) return;

        // Get target info from over element
        const targetRack = over.data.current?.rackName as string | undefined;
        const targetPosition = over.data.current?.position as number | undefined;

        if (!targetRack || !targetPosition) return;

        try {
            const response = await fetch("/admin/rack/api/update-position", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    deviceId,
                    rackName: targetRack,
                    rackPosition: targetPosition,
                }),
            });

            if (response.ok) {
                // Reload page to reflect changes
                window.location.reload();
            } else {
                const error = await response.json();
                alert(`Failed to move device: ${error.error}`);
            }
        } catch (error) {
            console.error("Failed to update device position:", error);
            alert("Failed to move device. Please try again.");
        }
    };

    const renderRackSlots = (rack: RackData) => {
        const slots = [];
        const totalU = rack.totalU || 42;

        for (let u = totalU; u >= 1; u--) {
            const row = totalU - u + 1;

            // Check if there is a device starting at exactly THIS u
            const device = rack.devices.find((d) => d.rackPosition === u);

            // Calculate if THIS u is occupied by ANY device
            const isOccupiedInfo = rack.devices.find(d =>
                d.rackPosition !== null &&
                u >= d.rackPosition &&
                u < d.rackPosition + (d.uHeight || 1)
            );

            if (device) {
                const uHeight = device.uHeight || 1;
                // Formulate the uppermost CSS grid row for this device.
                // Device covers from u to u + uHeight - 1. Topmost is u + uHeight - 1.
                const topRow = totalU - (u + uHeight - 1) + 1;

                slots.push(
                    <DraggableDevice
                        key={`device-${device.id}`}
                        device={device}
                        categoryName={device.categoryName}
                        gridRow={topRow}
                    />
                );
            }

            // Always render the DroppableSlot underneath. It acts as the grid cell targets.
            slots.push(
                <DroppableSlot
                    key={`slot-${rack.name}-${u}`}
                    u={u}
                    rackName={rack.name}
                    isOccupied={!!isOccupiedInfo}
                    gridRow={row}
                />
            );
        }

        return slots;
    };

    const renderRackLabels = (rack: RackData) => {
        const labels = [];
        const totalU = rack.totalU || 42;

        for (let u = totalU; u >= 1; u--) {
            const row = totalU - u + 1;
            labels.push(
                <div
                    key={`label-${rack.name}-${u}`}
                    className="text-[10px] text-slate-500 dark:text-slate-400 font-mono text-right pr-2 flex items-center justify-end"
                    style={{ gridColumn: "1", gridRow: row }}
                >
                    {u % 5 === 0 ? (
                        <span className="font-bold text-slate-400">{u}</span>
                    ) : (
                        <span className="w-3 border-t border-slate-700"></span>
                    )}
                </div>
            );
        }

        return labels;
    };

    if (racks.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <Server className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No rack data available</p>
                <p className="text-sm mt-2">Add devices with rack positions to see the layout</p>
                <p className="text-xs mt-4 text-slate-400">💡 Tip: Drag and drop devices to move them between racks</p>
            </div>
        );
    }

    // Render static content on server, DndContext only on client
    if (!isClient) {
        return (
            <div className="space-y-8">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
                    <div className="size-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-blue-400 text-sm">info</span>
                    </div>
                    <div>
                        <h4 className="font-medium text-blue-400">Drag & Drop Mode</h4>
                        <p className="text-sm text-slate-400 mt-1">
                            Drag devices to move them to different rack positions. Drop on an empty slot to relocate.
                        </p>
                    </div>
                </div>
                {/* Render rack layout without DndContext for SSR */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {racks.map((rack) => (
                        <div
                            key={`${rack.name}-${rack.zone || 'no-zone'}`}
                            className="bg-white dark:bg-card-dark rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
                        >
                            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white p-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-lg">{rack.name}</h3>
                                        <p className="text-xs text-slate-300">
                                            {rack.zone || "Unassigned Zone"} • {rack.devices.length} devices
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-slate-300">Occupancy</div>
                                        <div className="font-bold">
                                            {rack.occupiedU.length}U / {rack.totalU}U
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-2 h-2 bg-slate-600 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-500 to-green-500"
                                        style={{ width: `${(rack.occupiedU.length / rack.totalU) * 100}%` }}
                                    />
                                </div>
                            </div>
                            <div className="p-3 text-center text-sm text-slate-500 dark:text-slate-400">
                                Loading rack layout...
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
        >
            <div className="space-y-8">
                {/* Info Banner */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
                    <div className="size-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-blue-400 text-sm">info</span>
                    </div>
                    <div>
                        <h4 className="font-medium text-blue-400">Drag & Drop Mode</h4>
                        <p className="text-sm text-slate-400 mt-1">
                            Drag devices to move them to different rack positions. Drop on an empty slot to relocate.
                        </p>
                    </div>
                </div>

                {/* Device Detail Modal */}
                {selectedDevice && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                        onClick={() => setSelectedDevice(null)}
                    >
                        <div
                            className="bg-white dark:bg-card-dark rounded-lg shadow-xl max-w-md w-full p-6"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    Device Details
                                </h3>
                                <button
                                    onClick={() => setSelectedDevice(null)}
                                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                >
                                    <XCircle className="h-5 w-5" />
                                </button>
                            </div>

                            {selectedDevice.photoPath && (
                                <div className="mb-4">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={selectedDevice.photoPath}
                                        alt={selectedDevice.name}
                                        className="w-full h-40 object-cover rounded-md border border-slate-200 dark:border-slate-700"
                                    />
                                </div>
                            )}

                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Name</label>
                                    <p className="font-medium text-slate-900 dark:text-white">{selectedDevice.name}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Brand</label>
                                    <p className="text-slate-700 dark:text-slate-300">{selectedDevice.brandName || "-"}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Category</label>
                                    <p className="text-slate-700 dark:text-slate-300">{selectedDevice.categoryName}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Location</label>
                                    <p className="text-slate-700 dark:text-slate-300">{selectedDevice.locationName || "-"}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-slate-500 dark:text-slate-400">Last Status</label>
                                        <p className={`font-medium ${selectedDevice.status === 'Error' ? 'text-red-500' :
                                            selectedDevice.status === 'Warning' ? 'text-amber-500' :
                                                selectedDevice.status === 'OK' ? 'text-green-500' : 'text-slate-500'
                                            }`}>
                                            {selectedDevice.status || "Pending"}
                                        </p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-slate-500 dark:text-slate-400">Rack</label>
                                        <p className="font-medium">{selectedDevice.rackName}</p>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500 dark:text-slate-400">Position</label>
                                        <p className="font-medium">U{selectedDevice.rackPosition}</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Zone</label>
                                    <p className="text-slate-700 dark:text-slate-300">{selectedDevice.zone || "-"}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Rack Layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {racks.map((rack) => (
                        <div
                            key={`${rack.name}-${rack.zone || 'no-zone'}`}
                            className={`bg-white dark:bg-card-dark rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden transition-all ${isDragging ? "border-dashed border-2" : ""
                                }`}
                        >
                            {/* Rack Header */}
                            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white p-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-lg">{rack.name}</h3>
                                        <p className="text-xs text-slate-300">
                                            {rack.zone || "Unassigned Zone"} • {rack.devices.length} devices
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-slate-300">Occupancy</div>
                                        <div className="font-bold">
                                            {rack.occupiedU.length}U / {rack.totalU}U
                                        </div>
                                    </div>
                                </div>
                                {/* Occupancy Bar */}
                                <div className="mt-2 h-2 bg-slate-600 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all"
                                        style={{
                                            width: `${(rack.occupiedU.length / rack.totalU) * 100}%`,
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Rack Body */}
                            <div className="p-3">
                                <div
                                    className="grid gap-1"
                                    style={{
                                        gridTemplateColumns: "40px 1fr",
                                        gridAutoRows: "32px",
                                    }}
                                >
                                    {renderRackLabels(rack)}
                                    {renderRackSlots(rack)}
                                </div>
                            </div>

                            {/* Rack Footer */}
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-2 border-t border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                                    <span>Free: {rack.totalU - rack.occupiedU.length}U</span>
                                    <span>Utilization: {Math.round((rack.occupiedU.length / rack.totalU) * 100)}%</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Legend */}
                <div className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                    <h4 className="font-semibold text-slate-900 dark:text-white mb-3">Legend</h4>
                    <div className="flex flex-wrap gap-4">
                        {categories.map((cat) => (
                            <div key={cat.id} className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded shadow-sm" style={{ backgroundColor: cat.color || "#3b82f6" }}></div>
                                <span className="text-sm text-slate-600 dark:text-slate-400">{cat.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </DndContext>
    );
}
