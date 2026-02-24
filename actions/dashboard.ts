"use server";

import { db } from "@/db";
import { checklistEntries, devices, checklistItems, categories, users } from "@/db/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { verifySession } from "@/lib/session";

export async function getDashboardStats() {
    const session = await verifySession();
    const siteId = session?.activeSiteId;
    const today = new Date().toISOString().split('T')[0];

    // 1. Overall Completion
    const totalDevices = await db.select({ count: sql<number>`count(*)` }).from(devices)
        .where(siteId ? eq(devices.siteId, siteId) : undefined)
        .then(res => res[0].count);

    // Count devices checked today
    const checkedToday = await db.select({ count: sql<number>`count(distinct ${checklistItems.deviceId})` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(eq(checklistEntries.checkDate, today))
        .then(res => res[0].count);

    const overallCompletion = totalDevices > 0 ? Math.round((checkedToday / totalDevices) * 100) : 0;

    // 2. Completion by Category
    const allCategories = await db.select().from(categories);
    const categoryStats = [];

    for (const cat of allCategories) {
        const catDevices = await db.select({ count: sql<number>`count(*)` })
            .from(devices)
            .where(eq(devices.categoryId, cat.id))
            .then(res => res[0].count);

        const catChecked = await db.select({ count: sql<number>`count(distinct ${checklistItems.deviceId})` })
            .from(checklistItems)
            .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
            .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
            .where(and(
                eq(checklistEntries.checkDate, today),
                eq(devices.categoryId, cat.id)
            ))
            .then(res => res[0].count);

        categoryStats.push({
            id: cat.id,
            name: cat.name,
            total: catDevices,
            checked: catChecked,
            percentage: catDevices > 0 ? Math.round((catChecked / catDevices) * 100) : 0
        });
    }

    // 3. Recent Activity Feed
    const recentActivities = await db.select({
        id: checklistItems.id,
        device: devices.name,
        category: categories.name,
        status: checklistItems.status,
        remarks: checklistItems.remarks,
        user: users.username,
        time: checklistEntries.checkTime,
        date: checklistEntries.checkDate
    })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .innerJoin(categories, eq(devices.categoryId, categories.id))
        .innerJoin(users, eq(checklistEntries.userId, users.id))
        .orderBy(desc(checklistEntries.createdAt))
        .limit(5);

    return {
        overallCompletion,
        totalDevices,
        checkedToday,
        categoryStats,
        recentActivities
    };
}
