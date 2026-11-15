"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";

export type OperationsView = "activity" | "approvals";
export type OperationKind = "action" | "evaluation" | "handoff" | "simulation" | "readSync" | "localRun" | "notification" | "approval";
export type OperationStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "simulated" | "recorded" | "partial" | "expired" | "unknown";
export type OperationAction = "scan" | "isolate" | "unisolate" | "reboot" | "repair" | "other";
export type OperationRow = { id: number; kind: OperationKind; status: OperationStatus; action: OperationAction | null; createdAt: string | null };
export type OperationsLedger = { view: OperationsView; page: number; limit: number; total: number; rows: OperationRow[]; providerLocked: true };
type StoredRow = { id: number | null; kind: string | null; state: string | null; action_type: string | null; created_at: Date | string | null; total: string | number };

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
  const candidate = input as { view?: unknown; page?: unknown } | null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || Object.keys(candidate).some((key) => key !== "view" && key !== "page")) return { message: "Invalid ledger request." };
  const view = candidate.view ?? "activity";
  const page = candidate.page ?? 1;
  // Bounded offset as well as bounded page size; clients cannot choose site or limit.
  if ((view !== "activity" && view !== "approvals") || typeof page !== "number"
    || !Number.isSafeInteger(page) || page < 1 || page > 10000) return { message: "Invalid ledger request." };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const site = guard.activeSiteId;
      const actions = sql`SELECT id, 'action'::text AS kind, state, action_type, created_at
        FROM epdr_actions WHERE site_id = ${site}
        ${view === "approvals" ? sql`AND (mode = 'approval' OR state = 'pending_approval')` : sql``}`;
      const evaluations = sql`SELECT id, 'evaluation'::text AS kind, decision AS state, NULL::text AS action_type, created_at
        FROM epdr_rule_evaluations WHERE site_id = ${site}
        ${view === "approvals" ? sql`AND effective_mode = 'approval' AND action_id IS NULL` : sql``}`;
      const localHistory = view === "activity" ? sql`
        UNION ALL SELECT id, 'handoff'::text, 'recorded'::text, NULL::text, created_at
          FROM epdr_incident_handoffs WHERE site_id = ${site}
        UNION ALL SELECT id, 'simulation'::text, status, NULL::text, created_at
          FROM epdr_playbook_runs WHERE site_id = ${site}
        UNION ALL SELECT id, 'readSync'::text, status, NULL::text, requested_at AS created_at
          FROM epdr_read_sync_requests WHERE site_id = ${site}
        UNION ALL SELECT id, 'localRun'::text, status, NULL::text, created_at
          FROM epdr_local_playbook_runs WHERE site_id = ${site}
        UNION ALL SELECT id, 'notification'::text, status, NULL::text, created_at
          FROM epdr_local_notification_outbox WHERE site_id = ${site}
        UNION ALL SELECT id, 'approval'::text, CASE WHEN status = 'pending' AND expires_at <= clock_timestamp()
            THEN 'expired' ELSE status END, NULL::text, created_at
          FROM epdr_local_approvals WHERE site_id = ${site}` : sql``;
      // A single statement gives count and page the identical union and snapshot,
      // including a count when OFFSET is beyond the last row. No unscoped joins.
      const { rows } = await tx.execute<StoredRow>(sql`
        WITH ledger AS (${actions} UNION ALL ${evaluations} ${localHistory}),
        page_rows AS (SELECT id, kind, state, action_type, created_at FROM ledger
          ORDER BY created_at DESC NULLS LAST, kind ASC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50})
        SELECT page_rows.id, page_rows.kind, page_rows.state, page_rows.action_type, page_rows.created_at, totals.total
        FROM (SELECT count(*) AS total FROM ledger) totals LEFT JOIN page_rows ON true
        ORDER BY page_rows.created_at DESC NULLS LAST, page_rows.kind ASC, page_rows.id DESC`);
      const kinds: OperationKind[] = ["action", "evaluation", "handoff", "simulation", "readSync", "localRun", "notification", "approval"];
      const actionTypes: string[] = ["scan", "isolate", "unisolate", "reboot", "repair"];
      return { view, page, limit: 50, total: Number(rows[0]?.total ?? 0), providerLocked: true,
        rows: rows.filter((row) => row.id !== null && kinds.includes(row.kind as OperationKind)).map((row) => ({
          id: row.id!, kind: row.kind as OperationKind, status: status(row.state),
          action: row.kind === "action" ? (actionTypes.includes(row.action_type ?? "") ? row.action_type as OperationAction : "other") : null,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        })),
      };
    });
  } catch { return { message: "Operations unavailable. Check access and required migrations." }; }
}
