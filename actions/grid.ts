
"use server";

import { db } from "@/db";
import { checklistEntries, devices, checklistItems, categories, users, locations, racks } from "@/db/schema";
import { eq, and, gte, lte, or, isNull, sql } from "drizzle-orm";
import { requireActiveSiteAction } from "@/lib/action-auth";

export type DailyCheck = {
    status: string;
    username: string;
    shift: string;
    time: string;
};

export async function getAuditGridData(startDateStr?: string, endDateStr?: string) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { dates: [], gridData: [] };

    const siteId = auth.activeSiteId;

    // Determine bounds
    const today = new Date();
    const endDateObj = endDateStr ? new Date(endDateStr) : today;

    let startDateObj;
    if (startDateStr) {
        startDateObj = new Date(startDateStr);
    } else {
        startDateObj = new Date(endDateObj);
        startDateObj.setDate(startDateObj.getDate() - 6);
    }

    // Build array of dates inclusively
    const dates: string[] = [];
    const currentDate = new Date(startDateObj);
    while (currentDate <= endDateObj) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Safety check just in case date arrays balloon too large
    if (dates.length > 31) {
        // cap it at 31 days to prevent memory leaks from user abuse
        dates.length = 31;
    }

    const startBoundary = dates[0];
    const endBoundary = dates[dates.length - 1];

    // Get all devices with their category names
    const allDevices = await db.select({
        id: devices.id,
        name: devices.name,
        locationName: locations.name,
        categoryId: devices.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color
    })
        .from(devices)
        .leftJoin(categories, eq(devices.categoryId, categories.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .leftJoin(racks, and(eq(racks.siteId, devices.siteId), sql`lower(${racks.name}) = lower(${devices.rackName})`))
        .where(and(
            eq(devices.siteId, siteId),
            or(eq(racks.isAuditable, true), isNull(racks.id)),
        ))
        .orderBy(categories.name, devices.name);

    // Get checklist items for this range with user details
    const items = await db.select({
        deviceId: checklistItems.deviceId,
        date: checklistEntries.checkDate,
        time: checklistEntries.checkTime,
        shift: checklistEntries.shift,
        status: checklistItems.status,
        username: users.username
    })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(users, eq(checklistEntries.userId, users.id))
        .where(and(
            gte(checklistEntries.checkDate, startBoundary),
            lte(checklistEntries.checkDate, endBoundary),
            eq(checklistEntries.siteId, siteId)
        ))
        .orderBy(checklistEntries.checkDate, checklistEntries.checkTime);

    // Map to grid structure: Device -> { [date]: DailyCheck[] }
    const gridData = allDevices.map(device => {
        const deviceStatus: { [key: string]: DailyCheck[] } = {};

        // Initialize all dates with empty arrays
        dates.forEach(date => {
            deviceStatus[date] = [];
        });

        // Fill in actual status
        items.filter(i => i.deviceId === device.id).forEach(i => {
            deviceStatus[i.date].push({
                status: i.status,
                username: i.username,
                shift: i.shift,
                time: i.time
            });
        });

        return {
            ...device,
            statusHistory: deviceStatus
        };
    });

    return { dates, gridData };
}
