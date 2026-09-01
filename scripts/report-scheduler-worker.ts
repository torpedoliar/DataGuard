#!/usr/bin/env tsx
import dotenv from "dotenv";
import { db } from "@/db";
import { reportSchedules } from "@/db/schema";
import { executeReportSchedule } from "@/actions/report-schedules";
import { and, eq, lte } from "drizzle-orm";

dotenv.config();

const pollIntervalMs = Number(process.env.REPORTS_POLL_INTERVAL_MS ?? 60 * 1000); // 1 minute
const runOnce = process.argv.includes("--run-once");

async function checkAndRunDueSchedules() {
    const now = new Date();
    try {
        const dueSchedules = await db.query.reportSchedules.findMany({
            where: and(
                eq(reportSchedules.isActive, true),
                lte(reportSchedules.nextRunAt, now),
            ),
        });

        if (dueSchedules.length === 0) return 0;

        console.log(`[report-scheduler] Found ${dueSchedules.length} due schedule(s) at ${now.toISOString()}`);

        for (const schedule of dueSchedules) {
            console.log(`[report-scheduler] Executing schedule #${schedule.id} (${schedule.name})...`);
            try {
                const res = await executeReportSchedule(schedule.id);
                if (res.success) {
                    console.log(`[report-scheduler] Schedule #${schedule.id} executed successfully: ${res.message}`);
                } else {
                    console.error(`[report-scheduler] Schedule #${schedule.id} failed: ${res.error}`);
                }
            } catch (err) {
                console.error(`[report-scheduler] Unhandled error executing schedule #${schedule.id}:`, err);
            }
        }

        return dueSchedules.length;
    } catch (err) {
        console.error("[report-scheduler] Error querying due schedules:", err);
        return 0;
    }
}

async function loop() {
    console.log(`[report-scheduler] Worker started. Polling every ${pollIntervalMs / 1000}s...`);
    while (true) {
        await checkAndRunDueSchedules();
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}

if (runOnce) {
    checkAndRunDueSchedules()
        .then((count) => {
            console.log(`[report-scheduler] Run-once finished. Processed ${count} schedule(s).`);
            process.exit(0);
        })
        .catch((err) => {
            console.error("[report-scheduler] Run-once error:", err);
            process.exit(1);
        });
} else {
    void loop().catch((err) => {
        console.error("[report-scheduler] Fatal crash:", err);
        process.exit(1);
    });
}
