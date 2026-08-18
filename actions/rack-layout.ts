"use server";

import { db } from "../db";
import { devices, categories, checklistItems, checklistEntries, brands, locations, racks as racksTable } from "../db/schema";
import { sql, eq, asc, desc, inArray, and, isNotNull } from "drizzle-orm";
import { requireActiveSiteAction } from "../lib/action-auth";

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
}

export interface RackData {
    name: string;
    zone: string | null;
    totalU: number;
    devices: RackDevice[];
    occupiedU: number[];
    locationName: string | null;
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
        })
        .from(devices)
        .leftJoin(categories, eq(devices.categoryId, categories.id))
        .leftJoin(brands, eq(devices.brandId, brands.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .where(eq(devices.siteId, siteId))
        .orderBy(asc(devices.rackName), asc(devices.rackPosition));

    // Get latest checklist status for these devices
    const deviceIds = allDevices.map(d => d.id);
    const latestStatuses: Record<number, "OK" | "NOT OK" | "Pending"> = {};

    if (deviceIds.length > 0) {
        // Fetch all checks for these devices to find the latest one per device
        // Sorting by date desc, time desc ensures the first one we encounter per device is the latest
        const checks = await db
            .select({
                deviceId: checklistItems.deviceId,
                status: checklistItems.status,
            })
            .from(checklistItems)
            .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
            .where(inArray(checklistItems.deviceId, deviceIds))
            .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime));

        for (const check of checks) {
            if (!latestStatuses[check.deviceId]) {
                latestStatuses[check.deviceId] = check.status as "OK" | "NOT OK";
            }
        }
    }

    // Fetch all predefined racks for this site with location names
    const predefinedRacks = await db
        .select({
            id: racksTable.id,
            name: racksTable.name,
            zone: racksTable.zone,
            totalU: racksTable.totalU,
            locationName: locations.name,
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
            });
        }

        const rack = racks.get(rackKey)!;

        const deviceWithStatus = {
            ...device,
            status: latestStatuses[device.id] || "Pending"
        } as RackDevice;

        rack.devices.push(deviceWithStatus);

        // Mark occupied U positions
        const startU = device.rackPosition || 1;
        const uHeight = device.uHeight || 1;
        for (let i = startU; i < startU + uHeight; i++) {
            rack.occupiedU.push(i);
        }
    }

    return Array.from(racks.values()).sort((a, b) => {
        // Sort by zone then rack name
        if (a.zone !== b.zone) {
            return (a.zone || "").localeCompare(b.zone || "");
        }
        return a.name.localeCompare(b.name);
    });
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
