"use server";

import { getDevices } from "./master-data";
import { getProfileLayout, getRoomSettings } from "./rack-layout";
import { requireActiveSiteAction } from "@/lib/action-auth";

export async function getDeviceProfile(deviceId: number) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok || !Number.isInteger(deviceId) || deviceId <= 0) return null;
    const device = (await getDevices(deviceId)).find((d) => d.id === deviceId);
    if (!device) return null;
    const [layout, rooms] = await Promise.all([getProfileLayout(deviceId), getRoomSettings()]);
    if (!layout) return null;
    const rack = layout.racks.find((r) => r.devices.some((d) => d.id === deviceId)) ?? null;
    const visualDevice = rack?.devices.find((d) => d.id === deviceId) ?? layout.facilities.find((d) => d.id === deviceId) ?? {
        ...device, categoryColor: null, ports: [], isCritical: device.isCritical ?? false, openIncidents: { count: 0, maxSeverity: null },
    };
    return { device, visualDevice, rack, roomRacks: layout.racks.filter((r) => r.locationId === device.locationId),
        facilities: layout.facilities.filter((d) => d.locationId === device.locationId),
        room: device.locationId != null ? rooms[device.locationId] ?? null : null };
}
