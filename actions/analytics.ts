"use server";

import { db } from "@/db";
import { checklistEntries, checklistItems } from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { verifySession } from "@/lib/session";

export type DailyHealth = {
    date: string;
    status: "OK" | "Warning" | "Error" | "Unchecked";
};

export async function getDeviceHealthHistory(deviceId: number, days: number = 30): Promise<DailyHealth[]> {
    const session = await verifySession();
    if (!session) return [];

    // 1. Calculate the date window
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));

    const startDateStr = startDate.toISOString().split("T")[0]; // YYYY-MM-DD
    const endDateStr = endDate.toISOString().split("T")[0];

    // 2. Query checklist items for this device within the date range
    const records = await db.select({
        date: checklistEntries.checkDate,
        status: checklistItems.status,
    })
        .from(checklistItems)
        .innerJoin(checklistEntries, eq(checklistItems.entryId, checklistEntries.id))
        .where(
            and(
                eq(checklistItems.deviceId, deviceId),
                gte(checklistEntries.checkDate, startDateStr)
            )
        )
        .orderBy(desc(checklistEntries.checkDate), desc(checklistEntries.checkTime));

    // 3. Process into a daily map.
    // If multiple checks happen in a day, take the worst status (Error > Warning > OK)
    const statusPriority = { "Error": 3, "Warning": 2, "OK": 1 };

    const dailyMap: Record<string, "OK" | "Warning" | "Error"> = {};
    for (const row of records) {
        const currentDate = row.date;
        const currentStatus = row.status as "OK" | "Warning" | "Error";

        if (!dailyMap[currentDate]) {
            dailyMap[currentDate] = currentStatus;
        } else {
            // Keep the worst status
            if (statusPriority[currentStatus] > statusPriority[dailyMap[currentDate]]) {
                dailyMap[currentDate] = currentStatus;
            }
        }
    }

    // 4. Build exactly the requested 'days' array to ensure empty gaps are recorded as "Unchecked"
    const history: DailyHealth[] = [];
    const iterDate = new Date(startDate);

    for (let i = 0; i < days; i++) {
        const dateStr = iterDate.toISOString().split("T")[0];

        history.push({
            date: dateStr,
            status: dailyMap[dateStr] || "Unchecked",
        });

        iterDate.setDate(iterDate.getDate() + 1);
    }

    return history;
}
