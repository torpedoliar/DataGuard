"use server";

import { db } from "@/db";
import { checklistEntries, devices, checklistItems, categories, users, incidents } from "@/db/schema";
import { sql, eq, and, desc, ne, gte } from "drizzle-orm";
import { verifySession } from "@/lib/session";

function toDateString(d: Date) {
    return d.toISOString().split('T')[0];
}

export async function getDashboardStats() {
    const session = await verifySession();
    const siteId = session?.activeSiteId;
    const today = toDateString(new Date());
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const sevenDaysAgo = toDateString(weekStart);

    // 1. Overall Completion
    const totalDevices = await db.select({ count: sql<number>`count(*)` }).from(devices)
        .where(siteId ? eq(devices.siteId, siteId) : undefined)
        .then(res => Number(res[0].count));

    // Count devices checked today
    const checkedToday = await db.select({ count: sql<number>`count(distinct ${checklistItems.deviceId})` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                eq(checklistEntries.checkDate, today),
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            )
        )
        .then(res => Number(res[0].count));

    const overallCompletion = totalDevices > 0 ? Math.round((checkedToday / totalDevices) * 100) : 0;

    // 2. Completion by Category
    const allCategories = await db.select().from(categories);
    const categoryStats = [];

    for (const cat of allCategories) {
        const catDevices = await db.select({ count: sql<number>`count(*)` })
            .from(devices)
            .where(and(
                eq(devices.categoryId, cat.id),
                siteId ? eq(devices.siteId, siteId) : undefined
            ))
            .then(res => Number(res[0].count));

        const catChecked = await db.select({ count: sql<number>`count(distinct ${checklistItems.deviceId})` })
            .from(checklistItems)
            .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
            .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
            .where(and(
                eq(checklistEntries.checkDate, today),
                eq(devices.categoryId, cat.id),
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            ))
            .then(res => Number(res[0].count));

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
        .where(siteId ? eq(checklistEntries.siteId, siteId) : undefined)
        .orderBy(desc(checklistEntries.createdAt))
        .limit(5);

    const incidentStats = await db.select({
        open: sql<number>`sum(case when ${incidents.status} != 'Verified' then 1 else 0 end)`,
        critical: sql<number>`sum(case when ${incidents.severity} = 'Critical' and ${incidents.status} != 'Verified' then 1 else 0 end)`,
        overdue: sql<number>`sum(case when ${incidents.dueDate} < now() and ${incidents.status} != 'Verified' then 1 else 0 end)`,
    })
        .from(incidents)
        .where(siteId ? eq(incidents.siteId, siteId) : undefined)
        .then((res) => ({
            open: Number(res[0]?.open ?? 0),
            critical: Number(res[0]?.critical ?? 0),
            overdue: Number(res[0]?.overdue ?? 0),
        }));

    // 4. Daily completion over the last 7 days
    const dailyRows = await db.select({
        date: checklistEntries.checkDate,
        checked: sql<number>`count(distinct ${checklistItems.deviceId})`,
    })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                gte(checklistEntries.checkDate, sevenDaysAgo),
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            )
        )
        .groupBy(checklistEntries.checkDate)
        .orderBy(checklistEntries.checkDate);

    const checkedByDate = new Map(dailyRows.map(r => [r.date, r.checked]));
    const dailyCompletion = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const date = toDateString(d);
        const checked = checkedByDate.get(date) ?? 0;
        dailyCompletion.push({
            date,
            checked,
            total: totalDevices,
            percentage: totalDevices > 0 ? Math.round((checked / totalDevices) * 100) : 0,
        });
    }

    // 5. Incident trend over the last 7 days
    const incidentTrendRows = await db.select({
        date: sql<string>`date_trunc('day', ${incidents.createdAt})::date`,
        severity: incidents.severity,
        count: sql<number>`count(*)`,
    })
        .from(incidents)
        .where(
            and(
                gte(incidents.createdAt, new Date(`${sevenDaysAgo}T00:00:00Z`)),
                siteId ? eq(incidents.siteId, siteId) : undefined
            )
        )
        .groupBy(sql`date_trunc('day', ${incidents.createdAt})::date`, incidents.severity)
        .orderBy(sql`date_trunc('day', ${incidents.createdAt})::date`);

    type SeverityCount = { Critical: number; High: number; Medium: number; Low: number; total: number };
    const trendMap = new Map<string, SeverityCount>();
    for (const row of incidentTrendRows) {
        if (!trendMap.has(row.date)) {
            trendMap.set(row.date, { Critical: 0, High: 0, Medium: 0, Low: 0, total: 0 });
        }
        const entry = trendMap.get(row.date)!;
        if (row.severity === "Critical") entry.Critical = row.count;
        if (row.severity === "High") entry.High = row.count;
        if (row.severity === "Medium") entry.Medium = row.count;
        if (row.severity === "Low") entry.Low = row.count;
        entry.total += row.count;
    }

    const incidentTrend = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const date = toDateString(d);
        const entry = trendMap.get(date) ?? { Critical: 0, High: 0, Medium: 0, Low: 0, total: 0 };
        incidentTrend.push({ date, ...entry });
    }

    // 6. Recent open incidents
    const recentIncidents = await db.select({
        id: incidents.id,
        title: incidents.title,
        severity: incidents.severity,
        status: incidents.status,
        updatedAt: incidents.updatedAt,
    })
        .from(incidents)
        .where(
            and(
                ne(incidents.status, 'Verified'),
                siteId ? eq(incidents.siteId, siteId) : undefined
            )
        )
        .orderBy(desc(incidents.updatedAt))
        .limit(5);

    return {
        overallCompletion,
        totalDevices,
        checkedToday,
        categoryStats,
        recentActivities,
        incidentStats,
        dailyCompletion,
        incidentTrend,
        recentIncidents,
    };
}
