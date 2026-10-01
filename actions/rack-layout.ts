"use server";

import { db } from "../db";
import { devices, categories, checklistItems, checklistEntries, brands, locations, networkPorts, incidents, racks as racksTable } from "../db/schema";
import { sql, eq, asc, desc, inArray, and, isNotNull } from "drizzle-orm";
import { requireActiveSiteAction } from "../lib/action-auth";
import { compareRackOrder } from "../lib/rack-order";
import { foldIncidents, NO_INCIDENTS, type OpenIncidents } from "../lib/rack-signals";
import { resolveAppearance, type RoomAppearance } from "../lib/room-appearance";

export interface RackDevice {
    id: number;
    name: string;
    brandName: string | null;
    brandLogo: string | null;
    categoryId: number;
    categoryName: string | null;
    categoryColor: string | null;
    locationName: string | null;
    photoPath: string | null;
    rackName: string | null;
    rackPosition: number | null;
    uHeight: number | null;
    zone: string | null;
    status?: "OK" | "NOT OK" | "Pending";
    // Documented faceplate + ports (network docs), drawn on the 3D faceplate.
    faceplatePortCount: number | null;
    faceplateUplinkCount: number | null;
    faceplateRows: number | null;
    faceplateNumbering: string | null;
    ports: RackDevicePort[];
    isCritical: boolean;
    ipAddress: string | null;
    assetCode: string | null;
    // Open / In Progress incidents (badge + critical alert in 3D).
    openIncidents: OpenIncidents;
}

export interface RackDevicePort {
    id: number;
    portName: string;
    portIndex: number | null;
    mediaType: string | null;
    status: string | null;
    portMode: string | null;
    // Documented cabling (network docs): drawn as cables in 3D.
    connectedToDeviceId: number | null;
    connectedToPortId: number | null;
}

export interface RackData {
    name: string;
    zone: string | null;
    totalU: number;
    devices: RackDevice[];
    occupiedU: number[];
    locationName: string | null;
    locationId: number | null;
    floorRow: string | null;
    floorSlot: number | null;
    facing: string | null;
}

export async function getRackLayout() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    const siteId = auth.activeSiteId;

    // Get all devices with rack info
    const allDevices = await db
        .select({
            id: devices.id,
            name: devices.name,
            brandName: brands.name,
            brandLogo: brands.logoPath,
            categoryId: devices.categoryId,
            categoryName: categories.name,
            categoryColor: categories.color,
            locationName: locations.name,
            photoPath: devices.photoPath,
            rackName: devices.rackName,
            rackPosition: devices.rackPosition,
            uHeight: devices.uHeight,
            zone: devices.zone,
            faceplatePortCount: devices.faceplatePortCount,
            faceplateUplinkCount: devices.faceplateUplinkCount,
            faceplateRows: devices.faceplateRows,
            faceplateNumbering: devices.faceplateNumbering,
            isCritical: devices.isCritical,
            ipAddress: devices.ipAddress,
            assetCode: devices.assetCode,
        })
        .from(devices)
        .leftJoin(categories, eq(devices.categoryId, categories.id))
        .leftJoin(brands, eq(devices.brandId, brands.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .where(eq(devices.siteId, siteId))
        .orderBy(asc(devices.rackName), asc(devices.rackPosition));

    // Get latest checklist status for these devices
    const deviceIds = allDevices.map(d => d.id);

    // Ports of every racked device: faceplate drawing + cable routing in 3D.
    const portsByDevice = new Map<number, RackDevicePort[]>();
    const rackedIds = allDevices.filter((d) => d.rackName).map((d) => d.id);
    if (rackedIds.length > 0) {
        const ports = await db
            .select({
                deviceId: networkPorts.deviceId,
                id: networkPorts.id,
                portName: networkPorts.portName,
                portIndex: networkPorts.portIndex,
                mediaType: networkPorts.mediaType,
                status: networkPorts.status,
                portMode: networkPorts.portMode,
                connectedToDeviceId: networkPorts.connectedToDeviceId,
                connectedToPortId: networkPorts.connectedToPortId,
            })
            .from(networkPorts)
            .where(inArray(networkPorts.deviceId, rackedIds));
        for (const { deviceId, ...port } of ports) {
            portsByDevice.set(deviceId, [...(portsByDevice.get(deviceId) ?? []), port]);
        }
    }
    const latestStatuses: Record<number, "OK" | "NOT OK" | "Pending"> = {};

    if (deviceIds.length > 0) {
        // Latest status per device, scoped to TODAY's audit: a device checked
        // on an earlier day must not display as already audited today — the
        // daily run is the audit unit (same "today" rule as the dashboard),
        // and unsubmitted racks would otherwise show stale OK forever.
        // Sorting by date desc, time desc still picks each device's latest
        // check within the day (e.g. a re-audit on a later shift).
        const today = new Date().toISOString().split("T")[0];
        const checks = await db
            .select({
                deviceId: checklistItems.deviceId,
                status: checklistItems.status,
            })
            .from(checklistItems)
            .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
            .where(and(
                inArray(checklistItems.deviceId, deviceIds),
                eq(checklistEntries.checkDate, today),
            ))
            .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime));

        for (const check of checks) {
            if (!latestStatuses[check.deviceId]) {
                latestStatuses[check.deviceId] = check.status as "OK" | "NOT OK";
            }
        }
    }

    // Open incidents per device, worst severity first (site-scoped).
    const incidentsByDevice = deviceIds.length > 0
        ? foldIncidents(await db
            .select({ deviceId: incidents.deviceId, severity: incidents.severity, count: sql<number>`count(*)::int` })
            .from(incidents)
            .where(and(
                eq(incidents.siteId, siteId),
                inArray(incidents.status, ["Open", "In Progress"]),
                inArray(incidents.deviceId, deviceIds),
            ))
            .groupBy(incidents.deviceId, incidents.severity))
        : new Map<number, OpenIncidents>();

    // Fetch all predefined racks for this site with location names
    const predefinedRacks = await db
        .select({
            id: racksTable.id,
            name: racksTable.name,
            zone: racksTable.zone,
            totalU: racksTable.totalU,
            locationName: locations.name,
            locationId: racksTable.locationId,
            floorRow: racksTable.floorRow,
            floorSlot: racksTable.floorSlot,
            facing: racksTable.facing,
        })
        .from(racksTable)
        .leftJoin(locations, eq(racksTable.locationId, locations.id))
        .where(eq(racksTable.siteId, siteId));

    // Group devices by rack
    const racks = new Map<string, RackData>();

    // Initialize map with predefined racks
    for (const rackDef of predefinedRacks) {
        racks.set(rackDef.name.toLowerCase(), {
            name: rackDef.name,
            zone: rackDef.zone,
            totalU: rackDef.totalU || 42,
            devices: [],
            occupiedU: [],
            locationName: rackDef.locationName,
            locationId: rackDef.locationId,
            floorRow: rackDef.floorRow,
            floorSlot: rackDef.floorSlot,
            facing: rackDef.facing,
        });
    }

    for (const device of allDevices) {
        if (!device.rackName) continue;

        const rackKey = device.rackName.toLowerCase();

        // If a device specifies a rack that wasn't in our predefined table, we create it dynamically
        // (This supports legacy data before racks table was introduced)
        if (!racks.has(rackKey)) {
            racks.set(rackKey, {
                name: device.rackName,
                zone: device.zone, // Fallback to device's zone
                totalU: 42,
                devices: [],
                occupiedU: [],
                locationName: device.locationName, // Fallback to device's location
                locationId: null,
                floorRow: null,
                floorSlot: null,
                facing: null,
            });
        }

        const rack = racks.get(rackKey)!;

        const deviceWithStatus: RackDevice = {
            ...device,
            status: latestStatuses[device.id] || "Pending",
            ports: portsByDevice.get(device.id) ?? [],
            openIncidents: incidentsByDevice.get(device.id) ?? NO_INCIDENTS,
        };

        rack.devices.push(deviceWithStatus);

        // Mark occupied U positions
        const startU = device.rackPosition || 1;
        const uHeight = device.uHeight || 1;
        for (let i = startU; i < startU + uHeight; i++) {
            rack.occupiedU.push(i);
        }
    }

    // Same order as the 3D room (row, slot, name) so both views agree and a
    // drag-reorder in 2D sticks.
    return Array.from(racks.values()).sort(compareRackOrder);
}

export async function getRackStats() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return null;

    const siteId = auth.activeSiteId;

    const totalDevices = await db
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(eq(devices.siteId, siteId))
        .then(res => res[0].count);

    const devicesWithRack = await db
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(and(
            eq(devices.siteId, siteId),
            isNotNull(devices.rackName),
            isNotNull(devices.rackPosition)
        ))
        .then(res => res[0].count);

    const devicesByZone = await db
        .select({
            zone: devices.zone,
            count: sql<number>`count(*)`,
        })
        .from(devices)
        .where(eq(devices.siteId, siteId))
        .groupBy(devices.zone);

    const devicesByCategory = await db
        .select({
            category: categories.name,
            count: sql<number>`count(*)`,
        })
        .from(devices)
        .leftJoin(categories, eq(devices.categoryId, categories.id))
        .where(eq(devices.siteId, siteId))
        .groupBy(categories.name);

    return {
        totalDevices,
        devicesWithRack,
        devicesByZone,
        devicesByCategory,
    };
}

export interface RoomSettings {
    floorPlanPath: string | null;
    // Room temperature for the 3D label; null when not measured or excluded.
    tempC: number | null;
    tempThresholdC: number | null;
    appearance: RoomAppearance;
}

// Per-location settings (active site) for the 3D rack view.
export async function getRoomSettings(): Promise<Record<number, RoomSettings>> {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return {};

    const rows = await db
        .select({
            id: locations.id,
            floorPlanPath: locations.floorPlanPath,
            tempC: locations.tempC,
            tempThresholdC: locations.tempThresholdC,
            excludeTempCheck: locations.excludeTempCheck,
            lightColor: locations.lightColor,
            lightBrightness: locations.lightBrightness,
            wallpaper: locations.wallpaper,
            wallpaperPath: locations.wallpaperPath,
            wallpaperMode: locations.wallpaperMode,
        })
        .from(locations)
        .where(eq(locations.siteId, auth.activeSiteId));

    return Object.fromEntries(rows.map((r) => [r.id, {
        floorPlanPath: r.floorPlanPath,
        tempC: r.excludeTempCheck ? null : r.tempC,
        tempThresholdC: r.tempThresholdC,
        appearance: resolveAppearance(r),
    }]));
}
