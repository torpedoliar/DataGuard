"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";

export type LocalApprovalIntent = "scan" | "isolate";
export type LocalApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type LocalApprovalRow = {
  id: number; localRunId: number; detectionId: number; endpointId: number;
  actionIntent: LocalApprovalIntent; status: LocalApprovalStatus;
  requestedBy: number; decidedBy: number | null; decidedAt: string | null;
  decisionNote: string | null; expiresAt: string; createdAt: string;
};
export type LocalApprovalPage = { rows: LocalApprovalRow[]; total: number; limit: number; pending: number };
export type LocalApprovalDecision = {
  approvalId: number; status: "approved" | "rejected"; providerExecution: "blocked_read_only";
};

const requestSchema = z.object({
  runId: z.number().int().positive(), actionIntent: z.enum(["scan", "isolate"]), confirmLocalApproval: z.literal(true),
}).strict();
const decisionSchema = z.object({
  approvalId: z.number().int().positive(), decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
}).strict();
const idSchema = z.number().int().positive();
const unavailable = { message: "Local approval unavailable. No provider action was requested." };
const APPROVAL_LIMIT = 50;
const APPROVAL_WINDOW_HOURS = 24;

type EvidenceSummary = { templateId: string; steps: string[]; route: string };
/** Strict, minimal read of the immutable local-run evidence. Unknown shapes fail closed. */
function readRunEvidence(value: unknown): EvidenceSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = value as Record<string, unknown>;
  const definition = evidence.definition as { template?: { id?: unknown; steps?: unknown } } | undefined;
  const policy = evidence.responsePolicy as { status?: unknown; route?: unknown } | undefined;
  const template = definition?.template;
  if (evidence.providerLocked !== true || !template || typeof template.id !== "string" ||
      !Array.isArray(template.steps) || policy?.status !== "proposed" ||
      typeof policy.route !== "string" || policy.route.length === 0) return null;
  const steps = template.steps.filter((step): step is string => typeof step === "string");
  if (!steps.includes("scan") && !steps.includes("isolate")) return null;
  return { templateId: template.id, steps, route: policy.route };
}

const iso = (value: unknown) => value ? new Date(value as string | Date).toISOString() : null;

/**
 * Record a durable LOCAL approval request for a provider-action intention that
 * a saved local review proposed. This only stores a decision artifact: no queued
 * provider work, no transport call, and no Incident or notification mutation.
 */
export async function requestEpdrLocalApproval(input: unknown): Promise<{ approvalId: number; existing: boolean } | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { message: "Explicit local approval confirmation, run and supported intent required." };
  const { runId, actionIntent } = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      const { rows: bindings } = await tx.execute<{ id: number; account_revision: number }>(sql`
        SELECT id, account_revision FROM watchguard_connections
        WHERE site_id = ${guard.activeSiteId} AND enabled = true AND account_id <> '' FOR UPDATE`);
      const binding = bindings[0];
      if (!binding) throw new Error("binding_unavailable");
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: runs } = await tx.execute<{
        id: number; status: string; evidence: unknown; detection_id: number; endpoint_id: number;
      }>(sql`SELECT id, status, evidence, detection_id, endpoint_id FROM epdr_local_playbook_runs
        WHERE id = ${runId} AND site_id = ${guard.activeSiteId} AND connection_id = ${binding.id}
          AND account_revision = ${binding.account_revision} FOR SHARE`);
      const run = runs[0];
      if (!run) throw new Error("run_unavailable");
      const evidence = readRunEvidence(run.evidence);
      if (!evidence || !evidence.steps.includes(actionIntent)) throw new Error("intent_not_proposed");
      const { rows: endpoints } = await tx.execute<{ id: number }>(sql`
        SELECT id FROM epdr_endpoints
        WHERE id = ${run.endpoint_id} AND site_id = ${guard.activeSiteId} AND connection_id = ${binding.id}
          AND account_revision = ${binding.account_revision} AND removed_at IS NULL FOR SHARE`);
      if (!endpoints[0]) throw new Error("endpoint_unavailable");
      const { rows: existing } = await tx.execute<{ id: number }>(sql`
        SELECT id FROM epdr_local_approvals
        WHERE site_id = ${guard.activeSiteId} AND local_run_id = ${runId} AND action_intent = ${actionIntent}`);
      if (existing[0]) return { approvalId: existing[0].id, existing: true };
      const snapshot = {
        schemaVersion: 1, actionIntent, templateId: evidence.templateId, responsePolicyRoute: evidence.route,
        localRunId: runId, detectionId: run.detection_id, endpointId: run.endpoint_id,
        connectionId: binding.id, accountRevision: binding.account_revision,
        providerLocked: true, capturedAt: new Date().toISOString(),
      };
      const { rows: inserted } = await tx.execute<{ id: number }>(sql`
        INSERT INTO epdr_local_approvals
          (site_id, detection_id, local_run_id, endpoint_id, connection_id, account_revision,
           action_intent, snapshot, requested_by, expires_at)
        VALUES (${guard.activeSiteId}, ${run.detection_id}, ${runId}, ${run.endpoint_id}, ${binding.id},
          ${binding.account_revision}, ${actionIntent}, ${JSON.stringify(snapshot)}::jsonb, ${guard.session.userId},
          clock_timestamp() + interval '${sql.raw(String(APPROVAL_WINDOW_HOURS))} hours')
        RETURNING id`);
      if (!inserted[0]) throw new Error("approval_not_created");
      return { approvalId: inserted[0].id, existing: false };
    });
  } catch { return unavailable; }
}

/** Bounded local approval list; expiry is evaluated on read, never rewritten here. */
export async function getEpdrLocalApprovals(): Promise<LocalApprovalPage | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows } = await tx.execute<{
        id: number; local_run_id: number; detection_id: number; endpoint_id: number; action_intent: string;
        status: string; requested_by: number; decided_by: number | null; decided_at: Date | null;
        decision_note: string | null; expires_at: Date; created_at: Date; expired: boolean;
      }>(sql`SELECT id, local_run_id, detection_id, endpoint_id, action_intent, status, requested_by, decided_by,
          decided_at, decision_note, expires_at, created_at,
          (status = 'pending' AND expires_at <= clock_timestamp()) AS expired
        FROM epdr_local_approvals WHERE site_id = ${guard.activeSiteId}
        ORDER BY id DESC LIMIT ${APPROVAL_LIMIT}`);
      const { rows: counts } = await tx.execute<{ total: number; pending: number }>(sql`
        SELECT count(*)::integer AS total,
          count(*) filter (where status = 'pending' AND expires_at > clock_timestamp())::integer AS pending
        FROM epdr_local_approvals WHERE site_id = ${guard.activeSiteId}`);
      return {
        limit: APPROVAL_LIMIT, total: Number(counts[0]?.total ?? 0), pending: Number(counts[0]?.pending ?? 0),
        rows: rows.map((row) => ({
          id: row.id, localRunId: row.local_run_id, detectionId: row.detection_id, endpointId: row.endpoint_id,
          actionIntent: row.action_intent as LocalApprovalIntent,
          status: (row.expired ? "expired" : row.status) as LocalApprovalStatus,
          requestedBy: row.requested_by, decidedBy: row.decided_by, decidedAt: iso(row.decided_at),
          decisionNote: row.decision_note, expiresAt: iso(row.expires_at)!, createdAt: iso(row.created_at)!,
        })),
      };
    });
  } catch { return unavailable; }
}

/**
 * Approve/reject a local request. The approver must be a different current site
 * admin, the approval must be unexpired and bound to the current account
 * revision. Approval records `blocked_read_only`; it never queues or sends a
 * provider command.
 */
export async function decideEpdrLocalApproval(input: unknown): Promise<LocalApprovalDecision | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid local approval decision." };
  if (!idSchema.safeParse(parsed.data.approvalId).success) return unavailable;
  const { approvalId, decision, note } = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      const { rows: bindings } = await tx.execute<{ id: number; account_revision: number }>(sql`
        SELECT id, account_revision FROM watchguard_connections
        WHERE site_id = ${guard.activeSiteId} AND enabled = true AND account_id <> '' FOR UPDATE`);
      const binding = bindings[0];
      if (!binding) throw new Error("binding_unavailable");
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows } = await tx.execute<{
        id: number; requested_by: number; status: string; expires_at: Date; account_revision: number; connection_id: number;
      }>(sql`SELECT id, requested_by, status, expires_at, account_revision, connection_id FROM epdr_local_approvals
        WHERE id = ${approvalId} AND site_id = ${guard.activeSiteId} FOR UPDATE`);
      const approval = rows[0];
      if (!approval) throw new Error("approval_unavailable");
      if (approval.status !== "pending") throw new Error("approval_already_decided");
      if (new Date(approval.expires_at).getTime() <= Date.now()) return { message: "Approval expired." };
      if (approval.requested_by === guard.session.userId) throw new Error("requester_cannot_decide");
      if (approval.connection_id !== binding.id || approval.account_revision !== binding.account_revision) {
        throw new Error("account_revision_changed");
      }
      const status = decision === "approve" ? "approved" : "rejected";
      const decisionRecord = {
        schemaVersion: 1, decision: status,
        providerExecution: "blocked_read_only",
        reason: decision === "approve" ? "read_only_lock" : "rejected_by_admin",
      };
      const { rows: updated } = await tx.execute<{ id: number }>(sql`
        UPDATE epdr_local_approvals SET status = ${status}, decided_by = ${guard.session.userId},
          decided_at = clock_timestamp(), decision = ${JSON.stringify(decisionRecord)}::jsonb,
          decision_note = ${note ?? null}
        WHERE id = ${approvalId} AND site_id = ${guard.activeSiteId} AND status = 'pending'
        RETURNING id`);
      if (!updated[0]) throw new Error("approval_already_decided");
      return { approvalId, status: status as "approved" | "rejected", providerExecution: "blocked_read_only" as const };
    });
  } catch { return unavailable; }
}
