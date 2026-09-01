
"use server";

import { db } from "@/db";
import { checklistEntries, devices, checklistItems, categories, users, locations, racks } from "@/db/schema";
import { eq, and, gte, lte, or, isNull, sql } from "drizzle-orm";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
// Pure helpers live in their own module: every export of a "use server" file
// must be async, so buildGridExportRows cannot stay here.
import { buildGridExportRows } from "@/lib/grid-export";
// xlsx-js-style is a superset of the SheetJS community build (same utils API)
// with cell styling support; it replaces the plain xlsx import for the grid
// export so status cells carry the on-screen colors.
import * as XLSX from "xlsx-js-style";

export type DailyCheck = {
    status: string;
    username: string;
    shift: string;
    time: string;
};

export async function getAuditGridData(startDateStr?: string, endDateStr?: string) {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return { dates: [] as string[], gridData: [], roomTempByDate: {} as Record<string, string[]> };

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
            eq(devices.excludeChecklist, false),
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

        // Fill in actual status (deduplicated by date: keep latest check so
        // re-auditing or editing never displays duplicate double auditors)
        const latestByDate = new Map<string, DailyCheck>();
        items.filter(i => i.deviceId === device.id).forEach(i => {
            latestByDate.set(i.date, {
                status: i.status,
                username: i.username,
                shift: i.shift,
                time: i.time
            });
        });
        latestByDate.forEach((check, date) => {
            if (deviceStatus[date]) {
                deviceStatus[date].push(check);
            }
        });

        return {
            ...device,
            statusHistory: deviceStatus
        };
    });

    // Room-temperature readings per date (from the per-entry snapshot):
    // { [date]: "Room A 26.5°C (≤27)" / "Room B 31°C ⚠" } — only rooms with
    // a recorded reading that day.
    const tempRows = await db.select({
        checkDate: checklistEntries.checkDate,
        locationTemps: checklistEntries.locationTemps,
    })
        .from(checklistEntries)
        .where(and(
            gte(checklistEntries.checkDate, startBoundary),
            lte(checklistEntries.checkDate, endBoundary),
            eq(checklistEntries.siteId, siteId),
        ))
        .orderBy(checklistEntries.checkDate, checklistEntries.checkTime);
    const siteLocations = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(eq(locations.siteId, siteId));
    const locNameMap = new Map(siteLocations.map((l) => [String(l.id), l.name]));

    const roomTempByDate: Record<string, string[]> = {};
    for (const row of tempRows) {
        if (!row.checkDate) continue;
        for (const [locId, temp] of Object.entries(row.locationTemps ?? {})) {
            const locName = (temp as { locationName?: string }).locationName || locNameMap.get(String(locId)) || `Ruangan ${locId}`;
            const overThreshold = temp.tempC > temp.thresholdC;
            const line = overThreshold
                ? `${locName}: ${temp.tempC}°C ⚠ (batas ${temp.thresholdC}°C)`
                : `${locName}: ${temp.tempC}°C`;
            (roomTempByDate[row.checkDate] ??= []).push(line);
        }
    }

    return { dates, gridData, roomTempByDate };
}

/**
 * Raw grid data for client-side PDF rendering (jsPDF runs in the browser):
 * the matrix Device × Date with per-day check details, plus pre-aggregated
 * KPI numbers for the report header.
 */
export async function getRawGridExportData(startDateStr?: string, endDateStr?: string, statusFilter?: string) {
    const { dates, gridData, roomTempByDate } = await getAuditGridData(startDateStr, endDateStr);

    const filteredGridData = statusFilter && statusFilter !== "All"
        ? gridData.filter((device) =>
            dates.some((date) => (device.statusHistory[date] || []).some((check) => check.status === statusFilter)),
        )
        : gridData;

    // KPIs across the filtered matrix.
    let totalChecks = 0;
    let okChecks = 0;
    let notOkChecks = 0;
    const devicesWithIssue = new Set<number>();
    for (const device of filteredGridData) {
        for (const date of dates) {
            const checks = device.statusHistory[date] || [];
            for (const check of checks) {
                totalChecks++;
                if (check.status === "OK") okChecks++; else {
                    notOkChecks++;
                    devicesWithIssue.add(device.id);
                }
            }
        }
    }

    // Category summary rows: checks + NOT-OK counts per category.
    const byCategory = new Map<string, { total: number; notOk: number }>();
    for (const device of filteredGridData) {
        const category = device.categoryName || "Uncategorized";
        const entry = byCategory.get(category) ?? { total: 0, notOk: 0 };
        for (const date of dates) {
            for (const check of device.statusHistory[date] || []) {
                entry.total++;
                if (check.status !== "OK") entry.notOk++;
            }
        }
        byCategory.set(category, entry);
    }

    return {
        dates,
        gridData: filteredGridData,
        kpis: {
            totalDevices: filteredGridData.length,
            totalChecks,
            okChecks,
            notOkChecks,
            // Coverage = share of devices that were checked at least once in range.
            coveragePct: filteredGridData.length === 0
                ? 0
                : Math.round((filteredGridData.filter((d) => dates.some((date) => (d.statusHistory[date] || []).length > 0)).length / filteredGridData.length) * 100),
            devicesWithIssue: devicesWithIssue.size,
        },
        categories: Array.from(byCategory.entries())
            .map(([category, { total, notOk }]) => ({ category, total, notOk }))
            .sort((a, b) => b.notOk - a.notOk || b.total - a.total),
        roomTempByDate,
    };
}


/**
 * Server-side styled Excel export of the Audit Grid: matrix Device × Date
 * for the requested range (statusFilter applies the same device filter as
 * the page). Status cells are colored like the on-screen grid; header row is
 * dark with white text; device column frozen. Returns a base64 xlsx.
 */
export async function exportGridToExcel(startDateStr?: string, endDateStr?: string, statusFilter?: string) {
    const { dates, gridData, roomTempByDate } = await getAuditGridData(startDateStr, endDateStr);

    const filteredGridData = statusFilter && statusFilter !== "All"
        ? gridData.filter((device) =>
            dates.some((date) => (device.statusHistory[date] || []).some((check) => check.status === statusFilter)),
        )
        : gridData;

    const rows = buildGridExportRows(dates, filteredGridData);

    const header = ["Category", "Device", "Location", ...dates];
    const aoa: (string | number | null)[][] = [header];
    for (const row of rows) {
        aoa.push([
            row.category,
            row.device,
            row.location ?? "",
            ...dates.map((date) => (row[date] as string | number | null | undefined) ?? ""),
        ]);
    }

    // Room-temperature rows below the matrix (when any room was measured).
    if (Object.keys(roomTempByDate ?? {}).length > 0) {
        aoa.push([]); // spacer row
        const tempRow: (string | null)[] = ["Suhu Ruangan", "", ""];
        for (const date of dates) {
            tempRow.push((roomTempByDate?.[date] ?? []).join("; ") || null);
        }
        aoa.push(tempRow);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);

    // Column widths: fixed columns sized, date columns fit their content.
    worksheet["!cols"] = [
        { wch: 16 }, { wch: 26 }, { wch: 16 },
        ...dates.map((date) => ({
            wch: Math.min(38, Math.max(11, ...rows.map((row) => String(row[date] ?? "").length))),
        })),
    ];

    const statusFill = (value: string) => {
        if (!value) return undefined;
        if (value.includes("NOT OK")) return { fgColor: { rgb: "FEE2E2" }, bgColor: { rgb: "FEE2E2" } };
        return { fgColor: { rgb: "DCFCE7" }, bgColor: { rgb: "DCFCE7" } };
    };
    const statusFont = (value: string) => {
        if (!value) return undefined;
        if (value.includes("NOT OK")) return { color: { rgb: "991B1B" } };
        return { color: { rgb: "166534" } };
    };

    // Style the header row (dark fill, white bold text) and status cells.
    for (let col = 0; col < header.length; col++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: col })];
        if (cell) {
            cell.s = {
                fill: { fgColor: { rgb: "1E293B" }, bgColor: { rgb: "1E293B" } },
                font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
                alignment: { horizontal: "center", vertical: "center" },
                border: { bottom: { style: "thin", color: { rgb: "94A3B8" } } },
            };
        }
    }
    for (let r = 1; r < aoa.length; r++) {
        for (let c = 0; c < header.length; c++) {
            const cell = worksheet[XLSX.utils.encode_cell({ r, c: c })];
            if (!cell) continue;
            const value = String(cell.v ?? "");
            if (c >= 3) {
                const fill = statusFill(value);
                const font = statusFont(value);
                cell.s = {
                    alignment: { horizontal: "center", vertical: "center", wrapText: true },
                    ...(fill ? { fill } : {}),
                    ...(font ? { font } : {}),
                };
            } else if (c === 1) {
                cell.s = { font: { bold: true }, alignment: { vertical: "center" } };
            }
        }
    }

    // Freeze the 3 fixed columns + header row.
    worksheet["!freeze"] = { xSplit: 3, ySplit: 1 };
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: header.length - 1 } }) };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Grid");

    const buffer = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });

    await logAudit({
        action: "EXPORT",
        entity: "checklist",
        entityName: `Grid Excel ${dates[0] ?? "?"}..${dates[dates.length - 1] ?? "?"}`,
        detail: `start=${dates[0] ?? "-"}, end=${dates[dates.length - 1] ?? "-"}, status=${statusFilter ?? "all"}, devices=${rows.length}`,
    });

    return buffer;
}
