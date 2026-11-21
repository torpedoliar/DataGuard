"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";

export type OperationsView = "activity" | "approvals";
export type OperationKind = "action" | "evaluation" | "handoff" | "simulation" | "readSync" | "localRun" | "notification" | "approval";
export type OperationStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "simulated" | "recorded" | "partial" | "expired" | "unknown";
export type OperationAction = "scan" | "isolate" | "unisolate" | "reboot" | "repair" | "other";
export type OperationRow = { id: number; kind: OperationKind; status: OperationStatus; action: OperationAction | null; createdAt: string | null; requestedBy: string | null; approvedBy: string | null; selfApproved: boolean; context?: { incidentId?: number; detectionId?: number; versionId?: number; actionId?: number; localRunId?: number } };
export type OperationsLedger = { view: OperationsView; page: number; limit: number; total: number; rows: OperationRow[]; providerLocked: true };
type StoredRow = { incident_id?: number | null; detection_id?: number | null; version_id?: number | null; action_id?: number | null; local_run_id?: number | null; id: number | null; kind: string | null; state: string | null; action_type: string | null; created_at: Date | string | null; total: string | number; requested_by: number | null; approved_by: number | null; requester_name: string | null; approver_name: string | null };

function status(value: string | null): OperationStatus {
  switch (value) {
    case "pending": case "pending_approval": case "queued": return "pending";
    case "dispatching": case "in_progress": case "running": return "running";
    case "completed": case "succeeded": case "delivered": return "succeeded";
    case "partial": return "partial";
    case "failed": return "failed";
    case "cancelled": case "canceled": return "cancelled";
    case "blocked": case "blocked_read_only": case "suppressed": return "blocked";
    case "simulated": case "simulate": case "simulation_recorded": return "simulated";
    case "finished": case "recorded": case "approved": return "recorded";
    case "rejected": return "cancelled";
    case "expired": return "expired";
    default: return "unknown";
  }
}

/** Local ledger only. No provider payloads, approval transitions, or dispatch APIs. */
export async function getEpdrOperations(input: unknown = {}): Promise<OperationsLedger | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const candidate = input as { view?: unknown; page?: unknown; kind?: unknown; status?: unknown; from?: unknown; to?: unknown } | null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || Object.keys(candidate).some((key) => !["view", "page", "kind", "status", "from", "to"].includes(key))) return { message: "Invalid ledger request." };
  const view = candidate.view ?? "activity";
  const page = candidate.page ?? 1;
  // Bounded offset as well as bounded page size; clients cannot choose site or limit.
  if ((view !== "activity" && view !== "approvals") || typeof page !== "number"
    || !Number.isSafeInteger(page) || page < 1 || page > 10000) return { message: "Invalid ledger request." };
  const kinds: OperationKind[] = ["action", "evaluation", "handoff", "simulation", "readSync", "localRun", "notification", "approval"];
  const statuses: OperationStatus[] = ["pending", "running", "succeeded", "failed", "cancelled", "blocked", "simulated", "recorded", "partial", "expired", "unknown"];
  // Calendar dates are UTC, never browser/site-local midnight. End is inclusive
  // in the request and exclusive next-day midnight in SQL.
  function utcDate(value: unknown): number | null {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01" || value > "9998-12-31") return null;
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
  }
  const from = candidate.from === undefined ? undefined : utcDate(candidate.from);
  const to = candidate.to === undefined ? undefined : utcDate(candidate.to);
  if ((candidate.kind !== undefined && !kinds.includes(candidate.kind as OperationKind))
    || (candidate.status !== undefined && !statuses.includes(candidate.status as OperationStatus))
    || from === null || to === null || (from !== undefined && to !== undefined && from > to)) return { message: "Invalid ledger request." };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const site = guard.activeSiteId;
      const actions = sql`SELECT id, 'action'::text AS kind, state, action_type, created_at, requested_by, approved_by, NULL::integer AS incident_id, NULL::integer AS detection_id, NULL::integer AS version_id, id AS action_id, NULL::integer AS local_run_id
        FROM epdr_actions WHERE site_id = ${site}
        ${view === "approvals" ? sql`AND (mode = 'approval' OR state = 'pending_approval')` : sql``}`;
      const evaluations = sql`SELECT id, 'evaluation'::text AS kind, decision AS state, NULL::text AS action_type, created_at, NULL::integer AS requested_by, NULL::integer AS approved_by, incident_id, NULL::integer AS detection_id, NULL::integer AS version_id, action_id, NULL::integer AS local_run_id
        FROM epdr_rule_evaluations WHERE site_id = ${site}
        ${view === "approvals" ? sql`AND effective_mode = 'approval' AND action_id IS NULL` : sql``}`;
      const localHistory = view === "activity" ? sql`
        UNION ALL SELECT id, 'handoff'::text, 'recorded'::text, NULL::text, created_at, requested_by, NULL::integer, incident_id, detection_id, NULL::integer, NULL::integer, NULL::integer
          FROM epdr_incident_handoffs WHERE site_id = ${site}
        UNION ALL SELECT id, 'simulation'::text, status, NULL::text, created_at, requested_by, NULL::integer, NULL::integer, NULL::integer, version_id, NULL::integer, NULL::integer
          FROM epdr_playbook_runs WHERE site_id = ${site}
        UNION ALL SELECT id, 'readSync'::text, status, NULL::text, requested_at AS created_at, NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer
          FROM epdr_read_sync_requests WHERE site_id = ${site}
        UNION ALL SELECT id, 'localRun'::text, status, NULL::text, created_at, requested_by, NULL::integer, NULL::integer, detection_id, version_id, NULL::integer, id
          FROM epdr_local_playbook_runs WHERE site_id = ${site}
        UNION ALL SELECT id, 'notification'::text, status, NULL::text, created_at, NULL::integer, NULL::integer, incident_id, NULL::integer, NULL::integer, NULL::integer, NULL::integer
          FROM epdr_local_notification_outbox WHERE site_id = ${site}
        UNION ALL SELECT id, 'approval'::text, CASE WHEN status = 'pending' AND expires_at <= clock_timestamp()
            THEN 'expired' ELSE status END, NULL::text, created_at, requested_by, decided_by, NULL::integer, detection_id, NULL::integer, NULL::integer, local_run_id
          FROM epdr_local_approvals WHERE site_id = ${site}` : sql``;
      // A single statement gives count and page the identical union and snapshot,
      // including a count when OFFSET is beyond the last row. No unscoped joins.
      const { rows } = await tx.execute<StoredRow>(sql`
        WITH source AS (${actions} UNION ALL ${evaluations} ${localHistory}),
        normalized AS (SELECT source.*, CASE
          WHEN state IN ('pending', 'pending_approval', 'queued') THEN 'pending'
          WHEN state IN ('dispatching', 'in_progress', 'running') THEN 'running'
          WHEN state IN ('completed', 'succeeded', 'delivered') THEN 'succeeded'
          WHEN state IN ('cancelled', 'canceled', 'rejected') THEN 'cancelled'
          WHEN state IN ('blocked', 'blocked_read_only', 'suppressed') THEN 'blocked'
          WHEN state IN ('simulated', 'simulate', 'simulation_recorded') THEN 'simulated'
          WHEN state IN ('finished', 'recorded', 'approved') THEN 'recorded'
          WHEN state IN ('partial', 'failed', 'expired') THEN state ELSE 'unknown' END AS normalized_status FROM source),
        ledger AS (SELECT normalized.* FROM normalized WHERE true
          ${candidate.kind === undefined ? sql`` : sql`AND kind = ${candidate.kind}`}
          ${candidate.status === undefined ? sql`` : sql`AND normalized_status = ${candidate.status}`}
          ${from === undefined ? sql`` : sql`AND created_at >= ${new Date(from).toISOString()}::timestamptz`}
          ${to === undefined ? sql`` : sql`AND created_at < ${new Date(to + 86400000).toISOString()}::timestamptz`}),
        page_rows AS (SELECT id, kind, state, action_type, created_at, requested_by, approved_by, incident_id, detection_id, version_id, action_id, local_run_id FROM ledger
          ORDER BY created_at DESC NULLS LAST, kind ASC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50})
        SELECT page_rows.id, page_rows.kind, page_rows.state, page_rows.action_type, page_rows.created_at, page_rows.requested_by, page_rows.approved_by,
          scoped_incident.id AS incident_id, page_rows.detection_id, page_rows.version_id, page_rows.action_id, page_rows.local_run_id,
          requester.username AS requester_name, approver.username AS approver_name, totals.total
        FROM (SELECT count(*) AS total FROM ledger) totals LEFT JOIN page_rows ON true
        LEFT JOIN incidents scoped_incident ON scoped_incident.id = page_rows.incident_id AND scoped_incident.site_id = ${site}
        LEFT JOIN users requester ON requester.id = page_rows.requested_by
        LEFT JOIN users approver ON approver.id = page_rows.approved_by
        ORDER BY page_rows.created_at DESC NULLS LAST, page_rows.kind ASC, page_rows.id DESC`);
      const actionTypes: string[] = ["scan", "isolate", "unisolate", "reboot", "repair"];
      return { view, page, limit: 50, total: Number(rows[0]?.total ?? 0), providerLocked: true,
        rows: rows.filter((row) => row.id !== null && kinds.includes(row.kind as OperationKind)).map((row) => ({
          id: row.id!, kind: row.kind as OperationKind, status: status(row.state),
          action: row.kind === "action" ? (actionTypes.includes(row.action_type ?? "") ? row.action_type as OperationAction : "other") : null,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          requestedBy: row.requester_name ?? null, approvedBy: row.approver_name ?? null,
          ...((row.incident_id || row.detection_id || row.version_id || row.action_id || row.local_run_id) ? { context: {
            ...(row.incident_id ? { incidentId: row.incident_id } : {}), ...(row.detection_id ? { detectionId: row.detection_id } : {}),
            ...(row.version_id ? { versionId: row.version_id } : {}), ...(row.action_id ? { actionId: row.action_id } : {}),
            ...(row.local_run_id ? { localRunId: row.local_run_id } : {}),
          } } : {}),
          selfApproved: row.requested_by != null && row.requested_by === row.approved_by
            && (row.kind === "action" || (row.kind === "approval" && row.state === "approved")),
        })),
      };
    });
  } catch { return { message: "Operations unavailable. Check access and required migrations." }; }
}
