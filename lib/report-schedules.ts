import { reportSchedules } from "@/db/schema";

export type ReportScheduleItem = typeof reportSchedules.$inferSelect & {
    siteName?: string | null;
};

/**
 * Calculates the next UTC date-time for a schedule based on frequency, time, and day offset.
 * Pure logic — kept outside "use server" action files so it can be imported synchronously.
 */
export function calculateNextRun(
    frequency: string,
    runTime: string,
    dayOfWeek?: number | null,
    dayOfMonth?: number | null,
    baseDate = new Date()
): Date {
    const [hStr, mStr] = runTime.split(":");
    const hours = parseInt(hStr || "8", 10);
    const minutes = parseInt(mStr || "0", 10);

    const next = new Date(baseDate);
    next.setSeconds(0, 0);

    if (frequency === "daily") {
        next.setHours(hours, minutes, 0, 0);
        if (next.getTime() <= baseDate.getTime()) {
            next.setDate(next.getDate() + 1);
        }
        return next;
    }

    if (frequency === "weekly") {
        next.setHours(hours, minutes, 0, 0);
        const currentDay = next.getDay(); // 0 = Sunday, 1 = Monday...
        const targetDay = (typeof dayOfWeek === "number" && Number.isInteger(dayOfWeek)) ? dayOfWeek : 1;
        let daysUntil = (targetDay - currentDay + 7) % 7;
        if (daysUntil === 0 && next.getTime() <= baseDate.getTime()) {
            daysUntil = 7;
        }
        next.setDate(next.getDate() + daysUntil);
        return next;
    }

    if (frequency === "monthly") {
        const rawDay = (typeof dayOfMonth === "number" && Number.isInteger(dayOfMonth)) ? dayOfMonth : 1;
        const targetDay = Math.min(28, Math.max(1, rawDay));
        next.setDate(targetDay);
        next.setHours(hours, minutes, 0, 0);
        if (next.getTime() <= baseDate.getTime()) {
            next.setMonth(next.getMonth() + 1);
        }
        return next;
    }

    // Default fallback: +24h
    next.setDate(next.getDate() + 1);
    return next;
}
