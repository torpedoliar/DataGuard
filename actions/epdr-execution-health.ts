"use server";

/**
 * Execution health snapshot for site administrators.
 *
 * Read-only counters plus the oldest non-terminal requests, so a stuck queue
 * is visible without opening the ledger. No snapshot, payload or provider
 * response content is returned — only identifiers, states, ages and reasons.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";

export type ExecutionHealthError = { code: "forbidden" | "service_unavailable" };

export type ExecutionHealthCounts = {
  pendingApproval: number;
  queued: number;
  dispatching: number;
  inProgress: number;
  outcomeUnknown: number;
  needsReview: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export type StuckExecutionRequest = {
  id: number;
  actionType: string;
  state: string;
  hostName: string | null;
  ageMinutes: number;
  reason: string | null;
};

export type ExecutionHealthData = {
  counts: ExecutionHealthCounts;
  stuck: StuckExecutionRequest[];
};

export async function getEpdrExecutionHealth(): Promise<ExecutionHealthData | ExecutionHealthError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" };
  try {
    return await db.transaction(async (tx) => {
      // Serialize with the same actor-lock the read-sync queue uses: an admin
      // whose membership was just revoked sees nothing here.
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: countRows } = await tx.execute<Record<string, string | number>>(sql`
        SELECT
          count(*) FILTER (WHERE state = 'pending_approval') AS pending_approval,
          count(*) FILTER (WHERE state = 'queued') AS queued,
          count(*) FILTER (WHERE state = 'dispatching') AS dispatching,
          count(*) FILTER (WHERE state = 'in_progress') AS in_progress,
          count(*) FILTER (WHERE state = 'outcome_unknown') AS outcome_unknown,
          count(*) FILTER (WHERE state = 'needs_review') AS needs_review,
          count(*) FILTER (WHERE state = 'completed') AS completed,
          count(*) FILTER (WHERE state = 'failed') AS failed,
          count(*) FILTER (WHERE state = 'cancelled') AS cancelled
        FROM epdr_actions
        WHERE site_id = ${guard.activeSiteId} AND mode = 'approval' AND namespace IS NOT NULL`);
      const row = countRows[0] ?? {};
      const count = (key: string) => Number(row[key] ?? 0);

      const { rows: stuckRows } = await tx.execute<{
        id: number; action_type: string; state: string; host_name: string | null;
        age_minutes: number; reason: string | null;
      }>(sql`
        SELECT x.id, x.action_type, x.state, e.host_name,
          floor(extract(epoch FROM (clock_timestamp() - x.updated_at)) / 60)::integer AS age_minutes,
          coalesce(x.review_reason, x.outcome_unknown_reason) AS reason
        FROM epdr_actions x
        LEFT JOIN epdr_endpoints e ON e.id = x.endpoint_id
        WHERE x.site_id = ${guard.activeSiteId} AND x.mode = 'approval' AND x.namespace IS NOT NULL
          AND x.state IN ('pending_approval', 'queued', 'dispatching', 'in_progress', 'outcome_unknown', 'needs_review')
        ORDER BY x.updated_at ASC
        LIMIT 10`);

      return {
        counts: {
          pendingApproval: count("pending_approval"),
          queued: count("queued"),
          dispatching: count("dispatching"),
          inProgress: count("in_progress"),
          outcomeUnknown: count("outcome_unknown"),
          needsReview: count("needs_review"),
          completed: count("completed"),
          failed: count("failed"),
          cancelled: count("cancelled"),
        },
        stuck: stuckRows.map((stuck) => ({
          id: stuck.id,
          actionType: stuck.action_type,
          state: stuck.state,
          hostName: stuck.host_name,
          ageMinutes: Number(stuck.age_minutes ?? 0),
          reason: stuck.reason,
        })),
      };
    });
  } catch {
    return { code: "service_unavailable" };
  }
}
