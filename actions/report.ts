
"use server";

import { db } from "../db";
import { checklistEntries, checklistItems, devices, incidents, locations, racks } from "../db/schema";
import { eq, and, desc, sql, gte, lte, or, isNull } from "drizzle-orm";
import { requireActiveSiteAction } from "../lib/action-auth";
import { logAudit } from "../lib/audit";
import type { IncidentStatus } from "@/lib/incidents";
import * as XLSX from "xlsx";




export async function getAnalyticsStats() {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return null;

    const siteId = auth.activeSiteId;

    // 1. KPIs
    const totalItems = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(eq(checklistEntries.siteId, siteId))
        .then(res => Number(res[0].count));

    const okItems = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                eq(checklistItems.status, 'OK'),
                eq(checklistEntries.siteId, siteId)
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
                eq(checklistEntries.siteId, siteId)
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
        .where(eq(checklistEntries.siteId, siteId))
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
                eq(checklistEntries.siteId, siteId)
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
    pageSize: number = 20,
    incidentStatus?: IncidentStatus
) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { data: [], total: 0, totalPages: 0, currentPage: page };

    const siteId = auth.activeSiteId;

    // Build where clause. Same population as the dashboard/grid: auditable
    // rack (or no rack) AND not excluded from the checklist — so report
    // listings, totals, and pagination all agree with every other surface.
    // (Aggregates like getAnalyticsStats count checklist ITEMS and are not a
    // population, so they correctly stay unfiltered here.)
    const whereClause = and(
        gte(checklistEntries.checkDate, startDate),
        lte(checklistEntries.checkDate, endDate),
        eq(checklistEntries.siteId, siteId),
        eq(devices.excludeChecklist, false),
        incidentStatus ? eq(incidents.status, incidentStatus) : undefined,
        or(eq(racks.isAuditable, true), isNull(racks.id)),
    );

    // Get total count
    const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .leftJoin(racks, and(eq(racks.siteId, devices.siteId), sql`lower(${racks.name}) = lower(${devices.rackName})`))
        .leftJoin(incidents, eq(incidents.checklistItemId, checklistItems.id))
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
            location: locations.name,
            status: checklistItems.status,
            remarks: checklistItems.remarks,
            photo: checklistItems.photoPath,
            checker: sql<string>`(select username from users where id = ${checklistEntries.userId})`,
            category: sql<string>`(select name from categories where id = ${devices.categoryId})`,
            entryId: checklistEntries.id,
            incidentId: incidents.id,
            incidentStatus: incidents.status,
            incidentSeverity: incidents.severity,
        })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .leftJoin(racks, and(eq(racks.siteId, devices.siteId), sql`lower(${racks.name}) = lower(${devices.rackName})`))
        .leftJoin(incidents, eq(incidents.checklistItemId, checklistItems.id))
        .where(whereClause)
        .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime))
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);

    return { data: results, total, totalPages, currentPage };
}

export async function getRawExportData(startDate: string, endDate: string, incidentStatus?: IncidentStatus) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return null;

    const siteId = auth.activeSiteId;

    return await db
        .select({
            id: checklistItems.id,
            date: checklistEntries.checkDate,
            time: checklistEntries.checkTime,
            shift: checklistEntries.shift,
            device: devices.name,
            location: locations.name,
            status: checklistItems.status,
            remarks: checklistItems.remarks,
            photo: checklistItems.photoPath,
            checker: sql<string>`(select username from users where id = ${checklistEntries.userId})`,
            category: sql<string>`(select name from categories where id = ${devices.categoryId})`,
            incidentId: incidents.id,
            incidentStatus: incidents.status,
            incidentSeverity: incidents.severity,
        })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .innerJoin(devices, eq(checklistItems.deviceId, devices.id))
        .leftJoin(locations, eq(devices.locationId, locations.id))
        .leftJoin(racks, and(eq(racks.siteId, devices.siteId), sql`lower(${racks.name}) = lower(${devices.rackName})`))
        .leftJoin(incidents, eq(incidents.checklistItemId, checklistItems.id))
        .where(
            and(
                gte(checklistEntries.checkDate, startDate),
                lte(checklistEntries.checkDate, endDate),
                eq(checklistEntries.siteId, siteId),
                eq(devices.excludeChecklist, false),
                incidentStatus ? eq(incidents.status, incidentStatus) : undefined,
                or(eq(racks.isAuditable, true), isNull(racks.id)),
            )
        )
        .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime));
}

export async function exportToExcel(startDate: string, endDate: string, incidentStatus?: IncidentStatus) {
    // Get all data (no pagination for export)
    const data = await getRawExportData(startDate, endDate, incidentStatus);
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
        Incident: item.incidentId ? `#${item.incidentId}` : "-",
        IncidentStatus: item.incidentStatus ?? "-",
        IncidentSeverity: item.incidentSeverity ?? "-",
        Remarks: item.remarks || "-",
        Checker: item.checker,
        Photo: item.photo ? "Yes" : "No"
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });

    await logAudit({
        action: "EXPORT",
        entity: "checklist",
        entityName: `Excel ${startDate}..${endDate}`,
        detail: `start=${startDate}, end=${endDate}, status=${incidentStatus ?? "all"}, rows=${excelData.length}`,
    });

    return buffer;
}
