
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, devices } from "../db/schema";
import { eq, and, like, desc, sql, gte, lte } from "drizzle-orm";
import { verifySession } from "../lib/session";
import * as XLSX from "xlsx";




export async function getAnalyticsStats() {
    const session = await verifySession();
    if (!session) return null;

    const siteId = session.activeSiteId;

    // 1. KPIs
    const totalItems = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(siteId ? eq(checklistEntries.siteId, siteId) : undefined)
        .then(res => Number(res[0].count));

    const okItems = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                eq(checklistItems.status, 'OK'),
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            )
        )
        .then(res => Number(res[0].count));

    const openIssues = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                sql`${checklistItems.status} != 'OK'`,
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            )
        )
        .then(res => Number(res[0].count));
    const complianceRate = totalItems > 0 ? ((okItems / totalItems) * 100).toFixed(1) : "0";

    // 2. Monthly Trends (Last 12 months) - PostgreSQL compatible (assuming text date YYYY-MM-DD)
    const monthlyTrends = await db.select({
        month: sql<string>`SUBSTR(${checklistEntries.checkDate}, 1, 7)`,
        healthy: sql<number>`sum(case when ${checklistItems.status} = 'OK' then 1 else 0 end)`,
        faulty: sql<number>`sum(case when ${checklistItems.status} != 'OK' then 1 else 0 end)`
    })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(siteId ? eq(checklistEntries.siteId, siteId) : undefined)
        .groupBy(sql`SUBSTR(${checklistEntries.checkDate}, 1, 7)`)
        .orderBy(desc(sql`SUBSTR(${checklistEntries.checkDate}, 1, 7)`))
        .limit(12);

    // Reverse to show Jan -> Dec
    monthlyTrends.reverse();

    // 3. Failure by Category
    const failureByCategory = await db.select({
        category: sql<string>`${devices.categoryId}`,
        categoryName: sql<string>`(select name from categories where id = ${devices.categoryId})`,
        count: sql<number>`count(*)`
    })
        .from(checklistItems)
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                sql`${checklistItems.status} != 'OK'`,
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            )
        )
        .groupBy(devices.categoryId)
        .orderBy(desc(sql`count(*)`))
        .limit(5);

    return {
        kpis: {
            complianceRate,
            totalAudits: totalItems,
            openIssues,
            avgResolution: "4.2 hrs" // Mocked as we don't track resolution time yet
        },
        monthlyTrends,
        failureByCategory
    };
}

export async function getReportData(
    startDate: string,
    endDate: string,
    page: number = 1,
    pageSize: number = 20
) {
    const session = await verifySession();
    if (!session) return { data: [], total: 0, totalPages: 0, currentPage: page };

    const siteId = session.activeSiteId;

    // Build where clause
    const whereClause = and(
        gte(checklistEntries.checkDate, startDate),
        lte(checklistEntries.checkDate, endDate),
        siteId ? eq(checklistEntries.siteId, siteId) : undefined
    );

    // Get total count
    const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .where(whereClause)
        .then(res => res[0]?.count || 0);

    const total = Number(countResult);
    const totalPages = Math.ceil(total / pageSize);
    const currentPage = Math.min(page, totalPages) || 1;

    // Get paginated data
    const results = await db
        .select({
            id: checklistItems.id,
            date: checklistEntries.checkDate,
            time: checklistEntries.checkTime,
            shift: checklistEntries.shift,
            device: devices.name,
            location: devices.location,
            status: checklistItems.status,
            remarks: checklistItems.remarks,
            photo: checklistItems.photoPath,
            checker: sql<string>`(select username from users where id = ${checklistEntries.userId})`,
            category: sql<string>`(select name from categories where id = ${devices.categoryId})`,
            entryId: checklistEntries.id,
        })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .where(whereClause)
        .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime))
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);

    return { data: results, total, totalPages, currentPage };
}

export async function getRawExportData(startDate: string, endDate: string) {
    const session = await verifySession();
    if (!session) return null;

    const siteId = session.activeSiteId;

    return await db
        .select({
            id: checklistItems.id,
            date: checklistEntries.checkDate,
            time: checklistEntries.checkTime,
            shift: checklistEntries.shift,
            device: devices.name,
            location: devices.location,
            status: checklistItems.status,
            remarks: checklistItems.remarks,
            photo: checklistItems.photoPath,
            checker: sql<string>`(select username from users where id = ${checklistEntries.userId})`,
            category: sql<string>`(select name from categories where id = ${devices.categoryId})`,
        })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .where(
            and(
                gte(checklistEntries.checkDate, startDate),
                lte(checklistEntries.checkDate, endDate),
                siteId ? eq(checklistEntries.siteId, siteId) : undefined
            )
        )
        .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime));
}

export async function exportToExcel(startDate: string, endDate: string) {
    // Get all data (no pagination for export)
    const data = await getRawExportData(startDate, endDate);
    if (!data) return null;

    // Transform for Excel
    const excelData = data.map(item => ({
        Date: item.date,
        Time: item.time,
        Shift: item.shift,
        Device: item.device,
        Location: item.location,
        Category: item.category,
        Status: item.status,
        Remarks: item.remarks || "-",
        Checker: item.checker,
        Photo: item.photo ? "Yes" : "No"
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
    return buffer;
}

