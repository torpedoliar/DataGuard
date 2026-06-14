import { sql, desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { siemAlerts, auditLogs } from "@/db/schema";

export type MetricsBody = {
  siem: {
    alerts: { queued: number | null; sent: number | null; failed: number | null };
    retention: { lastRunAt: string | null };
    partition: { lastEnsureRunAt: string | null };
  };
  backup: { lastBackupAt: string | null; lastRestoreAt: string | null };
  health: { dbOk: boolean; appUptimeSec: number };
  timestamp: string;
};

export const EMPTY_ALERTS: MetricsBody["siem"]["alerts"] = {
  queued: null,
  sent: null,
  failed: null,
};

export async function countAlertsByStatus(): Promise<{
  queued: number;
  sent: number;
  failed: number;
} | null> {
  const rows = await db
    .select({ status: siemAlerts.status, count: sql<number>`count(*)::int` })
    .from(siemAlerts)
    .groupBy(siemAlerts.status);
  const out = { queued: 0, sent: 0, failed: 0 };
  for (const row of rows) {
    if (row.status === "pending") out.queued = Number(row.count) || 0;
    else if (row.status === "sent") out.sent = Number(row.count) || 0;
    else if (row.status === "failed") out.failed = Number(row.count) || 0;
  }
  return out;
}

export async function latestAuditAt(
  action: "UPDATE" | "DOWNLOAD" | "RESTORE",
  entity: string,
  entityName?: string,
): Promise<Date | null> {
  const conditions = entityName
    ? and(
        eq(auditLogs.action, action),
        eq(auditLogs.entity, entity),
        eq(auditLogs.entityName, entityName),
      )
    : and(eq(auditLogs.action, action), eq(auditLogs.entity, entity));
  const rows = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(conditions)
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

export async function collectMetrics(): Promise<MetricsBody> {
  try {
    const [alerts, retentionAt, partitionAt, backupAt, restoreAt] = await Promise.all([
      countAlertsByStatus(),
      latestAuditAt("UPDATE", "settings", "SIEM Retention"),
      latestAuditAt("UPDATE", "settings", "SIEM Partitioning"),
      latestAuditAt("DOWNLOAD", "settings"),
      latestAuditAt("RESTORE", "settings"),
    ]);

    return {
      siem: {
        alerts: alerts ?? { queued: 0, sent: 0, failed: 0 },
        retention: { lastRunAt: retentionAt ? retentionAt.toISOString() : null },
        partition: { lastEnsureRunAt: partitionAt ? partitionAt.toISOString() : null },
      },
      backup: {
        lastBackupAt: backupAt ? backupAt.toISOString() : null,
        lastRestoreAt: restoreAt ? restoreAt.toISOString() : null,
      },
      health: { dbOk: true, appUptimeSec: process.uptime() },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error) {
      // intentionally swallow — metrics never throws
    }
    return {
      siem: {
        alerts: EMPTY_ALERTS,
        retention: { lastRunAt: null },
        partition: { lastEnsureRunAt: null },
      },
      backup: { lastBackupAt: null, lastRestoreAt: null },
      health: { dbOk: false, appUptimeSec: process.uptime() },
      timestamp: new Date().toISOString(),
    };
  }
}
