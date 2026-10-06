"use client";

import { useState } from "react";
import DeviceProfile from "./device-profile";
import type { getDeviceProfile } from "@/actions/device-profile";
import type { RackDevice } from "@/actions/rack-layout";
import ActionButton from "@/components/ui/action-button";

const visual: RackDevice = { id: 9001, name: "Synthetic core switch", brandName: "Synthetic vendor", brandLogo: null, categoryId: 1, categoryName: "Network", categoryColor: "#22c55e", locationName: "Synthetic room", locationId: 1, photoPath: null, rackName: "Synthetic rack", rackPosition: 12, uHeight: 2, zone: "Demo", status: "Pending", faceplatePortCount: 24, faceplateUplinkCount: 4, faceplateRows: 2, faceplateNumbering: "sequential", ports: [], isCritical: true, ipAddress: null, assetCode: "SYNTHETIC-01", openIncidents: { count: 0, maxSeverity: null }, assetType: "standard" };
const device = { ...visual, brandId: null, floorX: null, floorZ: null, floorRotation: null, facilitySpecs: null, description: "Development fixture, no production records", isActive: true, excludeChecklist: false, isRackAuditable: true };
const rack = { name: "Synthetic rack", zone: "Demo", totalU: 42, devices: [visual], occupiedU: [12, 13], locationId: 1, locationName: "Synthetic room", floorRow: "A", floorSlot: 1, facing: "front" };
const profile = { device, visualDevice: visual, rack, roomRacks: [rack], facilities: [], room: null } as NonNullable<Awaited<ReturnType<typeof getDeviceProfile>>>;
const drawer = { loading: false, error: false, data: { picGroups: [], lastAudit: null, incidents: [], siem: { count: 0, latest: [] }, connections: [] } };
export default function DeviceProfileFixture() {
    const [open, setOpen] = useState(true);
    return <main className="mx-auto max-w-[1600px] p-4 space-y-4"><h1 className="font-bold">Synthetic admin profile fixture — no production data</h1><div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><aside className="rounded border border-ops-border p-3"><ActionButton variant="secondary" onClick={() => setOpen(true)}>Synthetic core switch</ActionButton></aside>{open && <DeviceProfile deviceId={9001} revision={0} canEdit={false} onClose={() => setOpen(false)} onEdit={() => {}} onSelectPeer={() => false} suppliedProfile={profile} suppliedDrawer={drawer} suppliedNetwork={{ loading: false, error: false, ports: [] }} />}</div></main>;
}
