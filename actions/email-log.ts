"use server";

import { db } from "@/db";
import { emailAlerts } from "@/db/schema";
import { verifySession } from "@/lib/session";
import { and, desc, sql } from "drizzle-orm";

// Admin-only history of PIC alert emails (email_alerts). Pattern mirrors
// getAuditLogs (lib/audit.ts): shared `where` for both the paged select and
// the COUNT so filtered results and pagination totals agree.

export type EmailAlertLog = typeof emailAlerts.$inferSelect;

export async function getEmailAlerts(options?: {
    limit?: number;
    offset?: number;
    status?: string;
    search?: string;
}): Promise<{ logs: EmailAlertLog[]; total: number }> {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { logs: [], total: 0 };
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions: ReturnType<typeof sql>[] = [];
    if (options?.status === "sent" || options?.status === "failed") {
        conditions.push(sql`status = ${options.status}`);
    }
    if (options?.search) {
        conditions.push(sql`(recipient ILIKE ${"%" + options.search + "%"} OR subject ILIKE ${"%" + options.search + "%"} OR device_summary ILIKE ${"%" + options.search + "%"})`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
        db.select().from(emailAlerts)
            .where(where)
            .orderBy(desc(emailAlerts.createdAt))
            .limit(limit)
            .offset(offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(emailAlerts).where(where),
    ]);

    return { logs, total: countResult[0]?.count ?? 0 };
}
