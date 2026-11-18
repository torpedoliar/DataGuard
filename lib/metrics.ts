import { sql, desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { siemAlerts, auditLogs } from "@/db/schema";

export type MetricsBody = {
  siem: {
    alerts: { queued: number | null; sent: number | null; failed: number | null };
    retention: { lastRunAt: string | null };
    partition: { lastEnsureRunAt: string | null };
  };
  epdr: {
    /** Non-terminal execution request counts; null when EPDR tables are missing. */
    queued: number | null;
    pendingApproval: number | null;
    expiredApproval: number | null;
    staleLease: number | null;
    observeDue: number | null;
    overdue: number | null;
    needsReview: number | null;
    outcomeUnknown: number | null;
    orphanAttempts: number | null;
    workers: number | null;
    workerLatestPassAt: string | null;
    retention: { lastRunAt: string | null };
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

/** Every counter null: missing tables must not break the whole payload. */
export const EMPTY_EPDR: MetricsBody["epdr"] = {
  queued: null,
  pendingApproval: null,
  expiredApproval: null,
  staleLease: null,
  observeDue: null,
  overdue: null,
  needsReview: null,
  outcomeUnknown: null,
  orphanAttempts: null,
  workers: null,
  workerLatestPassAt: null,
  retention: { lastRunAt: null },
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

/** One bounded execution-health snapshot; a missing EPDR schema surfaces as nulls. */
export async function collectEpdrMetrics(): Promise<MetricsBody["epdr"]> {
  const { rows } = await db.execute<{
    queued: number; pending_approval: number; expired_approval: number; stale_lease: number;
    observe_due: number; overdue: number; needs_review: number; outcome_unknown: number;
    orphan_attempts: number; workers: number; worker_latest_pass_at: string | null;
  }>(sql`
    SELECT
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state = 'queued') AS queued,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state = 'pending_approval') AS pending_approval,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state IN ('pending_approval', 'queued')
          AND approval_expires_at IS NOT NULL AND approval_expires_at <= clock_timestamp()) AS expired_approval,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state = 'dispatching'
          AND lease_expires_at IS NOT NULL AND lease_expires_at <= clock_timestamp()) AS stale_lease,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state IN ('in_progress', 'outcome_unknown')
          AND (observe_after IS NULL OR observe_after <= clock_timestamp())) AS observe_due,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state IN ('in_progress', 'outcome_unknown')
          AND deadline_at IS NOT NULL AND deadline_at <= clock_timestamp()) AS overdue,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state = 'needs_review') AS needs_review,
      (SELECT count(*) FROM epdr_actions
        WHERE mode = 'approval' AND namespace IS NOT NULL AND state = 'outcome_unknown') AS outcome_unknown,
      -- A committed dispatch attempt still claiming 'sending' while its action
      -- left 'dispatching' is crash evidence the reconciler must pick up.
      (SELECT count(*) FROM epdr_attempts a
        JOIN epdr_actions x ON x.id = a.action_id
        WHERE a.phase = 'dispatch' AND a.status = 'sending' AND x.state <> 'dispatching') AS orphan_attempts,
      (SELECT count(*) FROM epdr_worker_heartbeats) AS workers,
      (SELECT max(last_pass_at)::text FROM epdr_worker_heartbeats) AS worker_latest_pass_at`);
  const row = rows[0];
  const retentionAt = await latestAuditAt("UPDATE", "settings", "EPDR Execution Retention");
  return {
    queued: Number(row?.queued ?? 0),
    pendingApproval: Number(row?.pending_approval ?? 0),
    expiredApproval: Number(row?.expired_approval ?? 0),
    staleLease: Number(row?.stale_lease ?? 0),
    observeDue: Number(row?.observe_due ?? 0),
    overdue: Number(row?.overdue ?? 0),
    needsReview: Number(row?.needs_review ?? 0),
    outcomeUnknown: Number(row?.outcome_unknown ?? 0),
    orphanAttempts: Number(row?.orphan_attempts ?? 0),
    workers: Number(row?.workers ?? 0),
    workerLatestPassAt: row?.worker_latest_pass_at ? new Date(row.worker_latest_pass_at).toISOString() : null,
    retention: { lastRunAt: retentionAt ? retentionAt.toISOString() : null },
  };
}

export async function collectMetrics(): Promise<MetricsBody> {
  let epdr: MetricsBody["epdr"] = EMPTY_EPDR;
  try {
    epdr = await collectEpdrMetrics();
  } catch (error) {
    if (error) {
      // EPDR tables may not exist yet (pre-migration); metrics never throws.
    }
  }
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
      epdr,
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
      epdr: EMPTY_EPDR,
      backup: { lastBackupAt: null, lastRestoreAt: null },
      health: { dbOk: false, appUptimeSec: process.uptime() },
      timestamp: new Date().toISOString(),
    };
  }
}
