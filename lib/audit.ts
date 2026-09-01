
"use server";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { verifySession } from "./session";
import { and, desc, sql } from "drizzle-orm";

export type AuditAction =
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "LOGIN"
    | "LOGOUT"
    | "TOGGLE"
    | "UPLOAD"
    | "EXPORT"
    | "DOWNLOAD"
    | "RESTORE"
    | "TEST"
    | "SCHEMA_PUSH"
    | "SITE_SWITCH"
    | "BACKUP"
    // Finding #59: fire-and-forget Telegram alert sends (checklist & incident
    // notifications) are audited with chatId + success/failure so outbound
    // notifications leave a trail even though they never block the caller.
    | "TELEGRAM_SEND";

export type AuditEntity =
    | "device"
    | "device_group"
    | "brand"
    | "category"
    | "location"
    | "rack"
    | "user"
    | "vlan"
    | "network_port"
    | "syslog_source"
    | "syslog_event"
    | "siem_finding"
    | "checklist"
    | "incident"
    | "settings"
    | "report_schedule"
    | "site"
    | "site_telegram_chat"
    | "user_site"
    | "session";

export interface AuditParams {
    action: AuditAction;
    entity?: AuditEntity;
    entityId?: number;
    entityName?: string;
    detail?: string;
}

/**
 * Log an audit event. Safe to call from any Server Action (fire-and-forget).
 * Never throws — audit failures should not break the main operation.
 */
export async function logAudit(params: AuditParams): Promise<void> {
    try {
        const session = await verifySession();
        if (!session) return;

        await db.insert(auditLogs).values({
            userId: session.userId,
            username: session.username,
            userRole: session.role,
            action: params.action,
            entity: params.entity ?? null,
            entityId: params.entityId ?? null,
            entityName: params.entityName ?? null,
            detail: params.detail ?? null,
            siteId: session.activeSiteId ?? null,
            siteName: session.activeSiteName ?? null,
        });
    } catch (_e) {
        // Never throw from audit — we don't want to break the main action
        console.error("[AUDIT] Failed to write audit log:", _e);
    }
}

/**
 * Server Action – Log audit without session (e.g. login attempt before session exists)
 */
export async function logAuditManual(params: AuditParams & {
    userId?: number;
    username?: string;
    userRole?: string;
    siteId?: number | null;
    siteName?: string | null;
}): Promise<void> {
    try {
        await db.insert(auditLogs).values({
            userId: params.userId ?? null,
            username: params.username ?? null,
            userRole: params.userRole ?? null,
            action: params.action,
            entity: params.entity ?? null,
            entityId: params.entityId ?? null,
            entityName: params.entityName ?? null,
            detail: params.detail ?? null,
            siteId: params.siteId ?? null,
            siteName: params.siteName ?? null,
        });
    } catch (_e) {
        console.error("[AUDIT] Failed to write manual audit log:", _e);
    }
}

/**
 * Fetch audit logs with optional filtering & pagination
 */
export async function getAuditLogs(options?: {
    limit?: number;
    offset?: number;
    entity?: string;
    action?: string;
    search?: string;
}): Promise<{ logs: typeof auditLogs.$inferSelect[]; total: number }> {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { logs: [], total: 0 };
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions: ReturnType<typeof sql>[] = [];
    if (options?.entity) conditions.push(sql`entity = ${options.entity}`);
    if (options?.action) conditions.push(sql`action = ${options.action}`);
    if (options?.search) {
        conditions.push(sql`(username ILIKE ${"%" + options.search + "%"} OR entity_name ILIKE ${"%" + options.search + "%"} OR detail ILIKE ${"%" + options.search + "%"})`);
    }

    // Apply the combined predicate to BOTH the paged select and the COUNT
    // query so filtered results and pagination totals agree. When no filter
    // is present the predicate is undefined (unscoped listing).
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rawLogs = await db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

    const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .where(where);

    return {
        logs: rawLogs,
        total: countResult[0]?.count ?? 0,
    };
}
