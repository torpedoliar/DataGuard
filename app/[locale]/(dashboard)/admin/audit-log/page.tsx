
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";
import { desc, sql, like, and, eq } from "drizzle-orm";
import { getSettings } from "@/actions/settings";
import AuditLogClient from "@/components/admin/audit-log-client";

export const metadata = {
    title: "Audit Log | DataGuard"
};

export default async function AuditLogPage({
    searchParams,
}: {
    searchParams: Promise<{ page?: string; search?: string; entity?: string; action?: string }>;
}) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        redirect("/dashboard");
    }

    const params = await searchParams;
    const page = Math.max(1, parseInt(params.page || "1"));
    const search = params.search || "";
    const entityFilter = params.entity || "";
    const actionFilter = params.action || "";
    const limit = 50;
    const offset = (page - 1) * limit;

    // Build conditions
    const conditions = [];
    if (search) {
        conditions.push(
            sql`(${auditLogs.username} ILIKE ${`%${search}%`} OR ${auditLogs.entityName} ILIKE ${`%${search}%`} OR ${auditLogs.detail} ILIKE ${`%${search}%`})`
        );
    }
    if (entityFilter) conditions.push(eq(auditLogs.entity, entityFilter));
    if (actionFilter) conditions.push(eq(auditLogs.action, actionFilter));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
        db.select().from(auditLogs)
            .where(whereClause)
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
            .offset(offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(auditLogs).where(whereClause),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    const appSettings = await getSettings();

    return (
        <AuditLogClient
            logs={logs}
            total={total}
            page={page}
            totalPages={totalPages}
            limit={limit}
            search={search}
            entityFilter={entityFilter}
            actionFilter={actionFilter}
            appName={appSettings.appName}
        />
    );
}
