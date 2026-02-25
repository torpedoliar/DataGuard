"use server";

import { db } from "../db";
import { devices, categories, checklistItems, checklistEntries, brands, locations, racks as racksTable } from "../db/schema";
import { sql, eq, asc, desc, inArray } from "drizzle-orm";
import { verifySession } from "../lib/session";

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
    status?: "OK" | "Warning" | "Error" | "Pending";
}

export interface RackData {
    name: string;
    zone: string | null;
    totalU: number;
    devices: RackDevice[];
    occupiedU: number[];
}

export async function getRackLayout() {
    const session = await verifySession();
    if (!session) return [];

    const siteId = session.activeSiteId;

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
        .where(siteId ? eq(devices.siteId, siteId) : undefined)
        .orderBy(asc(devices.rackName), asc(devices.rackPosition));

    // Get latest checklist status for these devices
    const deviceIds = allDevices.map(d => d.id);
    let latestStatuses: Record<number, "OK" | "Warning" | "Error" | "Pending"> = {};

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
                latestStatuses[check.deviceId] = check.status as "OK" | "Warning" | "Error";
            }
        }
    }

    // Fetch all predefined racks for this site
    const predefinedRacks = await db.select().from(racksTable).where(siteId ? eq(racksTable.siteId, siteId) : undefined);

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
    const session = await verifySession();
    if (!session) return null;

    const siteId = session.activeSiteId;

    const totalDevices = await db
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(siteId ? eq(devices.siteId, siteId) : undefined)
        .then(res => res[0].count);

    const devicesWithRack = await db
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(siteId ? eq(devices.siteId, siteId) : undefined)
        .then(res => res[0].count);

    const devicesByZone = await db
        .select({
            zone: devices.zone,
            count: sql<number>`count(*)`,
        })
        .from(devices)
        .groupBy(devices.zone);

    const devicesByCategory = await db
        .select({
            category: categories.name,
            count: sql<number>`count(*)`,
        })
        .from(devices)
        .leftJoin(categories, eq(devices.categoryId, categories.id))
        .groupBy(categories.name);

    return {
        totalDevices,
        devicesWithRack,
        devicesByZone,
        devicesByCategory,
    };
}
