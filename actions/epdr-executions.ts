"use server";

/**
 * Provider write execution requests.
 *
 * A request is a durable, immutable intent. Creating one never contacts the
 * provider: it records the frozen snapshot and waits for a *different* site
 * administrator to approve it. Approval moves the request into `queued`; only
 * the worker dispatcher can then send it, and only after re-validating every
 * gate against fresh trusted state.
 *
 * Historical local approvals (`epdr_local_approvals`) remain decision records
 * and are never read as execution authorization here.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { getWriteOperation, type WriteActionType } from "@/lib/epdr/execution-capability";
import { EXECUTABLE_ACTION_TYPES } from "@/lib/epdr/capabilities";
import { evaluateExecutionPolicy } from "@/lib/epdr/execution-policy";
import { buildExecutionSnapshot } from "@/lib/epdr/execution-snapshot";
import { OFFLINE_FREEZE_DAYS } from "@/lib/epdr/health";
import {
  executionIntentKey,
  executionSnapshotHash,
  validateExecutionSnapshot,
} from "@/lib/epdr/execution-request";
import {
  countRecentDispatches,
  countRecentRequests,
  hasRecentDispatch,
  hasWriteCredentials,
  isActiveSiteAdmin,
  loadConnectionBinding,
  loadEndpointExecutionState,
  loadExecutionSettings,
} from "@/lib/epdr/execution-store";

export type ExecutionErrorCode =
  | "invalid_input"
  | "forbidden"
  | "write_disabled"
  | "action_not_allowed"
  | "connection_unavailable"
  | "credentials_missing"
  | "endpoint_unavailable"
  | "target_unresolved"
  | "blocked"
  | "duplicate_active_request"
  | "not_found"
  | "state_conflict"
  | "service_unavailable";

export type ExecutionError = { code: ExecutionErrorCode; reason?: string };

export type ExecutionOptions = {
  writeEnabled: boolean;
  /** Bounded reasons why execution is currently unavailable. */
  disabledReasons: string[];
  approvalExpiryMinutes: number;
  /** Effective per-site limits the request and approve stages enforce. */
  limits: {
    maxActionsPerHour: number;
    cooldownMinutes: number;
    siteMaxActionsPerHour: number | null;
  };
  actions: {
    actionType: WriteActionType;
    namespace: "endpoint_security" | "threatsync";
    highImpact: boolean;
    observationSupport: "automatic" | "manual_review";
    requiredParams: readonly string[];
    allowedParams: readonly string[];
  }[];
  endpoints: {
    id: number;
    hostName: string | null;
    isolationState: number | null;
    hold: boolean;
    dataFresh: boolean;
  }[];
};

const createSchema = z.object({
  endpointId: z.number().int().positive(),
  actionType: z.string().min(1).max(64),
  parameters: z.record(z.string(), z.unknown()).optional(),
  confirmExecutionRequest: z.literal(true),
}).strict();

const approveSchema = z.object({
  requestId: z.number().int().positive(),
  confirmApproval: z.literal(true),
}).strict();

const requestIdSchema = z.object({ requestId: z.number().int().positive() }).strict();

function error(code: ExecutionErrorCode, reason?: string): ExecutionError {
  return reason ? { code, reason } : { code };
}

/** Durable, bounded audit trail; never blocks the mutation on failure. */
function auditExecution(event: string, requestId: number, detail?: Record<string, unknown>): void {
  void logAudit({
    action: "EPDR_EXECUTION",
    entity: "epdr_action",
    entityId: requestId,
    detail: JSON.stringify({ event, ...detail }),
  });
}

/** Whether the deployment and this site both allow provider writes. */
export async function getEpdrExecutionOptions(): Promise<ExecutionOptions | ExecutionError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  try {
    const settings = await loadExecutionSettings(guard.activeSiteId);
    const binding = await loadConnectionBinding(guard.activeSiteId);
    const credentials = await hasWriteCredentials(guard.activeSiteId);
    const disabledReasons: string[] = [];
    if (!settings.globalWritesEnabled) disabledReasons.push("global_writes_disabled");
    if (!settings.siteWritesEnabled) disabledReasons.push("site_writes_disabled");
    if (settings.globalKillSwitch) disabledReasons.push("global_kill_switch");
    if (settings.siteKillSwitch) disabledReasons.push("site_kill_switch");
    if (settings.automationPaused) disabledReasons.push("automation_paused");
    if (!binding?.enabled) disabledReasons.push("connection_disabled");
    if (!credentials) disabledReasons.push("write_credentials_missing");

    const actions = EXECUTABLE_ACTION_TYPES.map((actionType) => {
      const operation = getWriteOperation(
        actionType.startsWith("ts_") ? "threatsync" : "endpoint_security",
        actionType,
      );
      return {
        actionType,
        namespace: operation?.namespace ?? ("endpoint_security" as const),
        highImpact: operation?.highImpact ?? true,
        observationSupport: operation?.observationSupport ?? ("manual_review" as const),
        requiredParams: operation?.requiredParams ?? [],
        allowedParams: operation?.allowedParams ?? [],
      };
    }).filter((entry) => entry.namespace !== undefined);

    const { rows } = await db.execute<{
      id: number; host_name: string | null; isolation_state: number | null; hold: boolean | null;
      fresh: boolean | null;
    }>(sql`
      SELECT e.id, e.host_name, e.isolation_state,
        (e.last_connection_at IS NOT NULL
          AND e.last_connection_at > clock_timestamp() - interval '${sql.raw(String(OFFLINE_FREEZE_DAYS))} days') AS fresh,
        EXISTS (SELECT 1 FROM incidents i JOIN epdr_workflows w ON w.incident_id = i.id AND w.site_id = i.site_id
          WHERE w.site_id = e.site_id AND w.endpoint_id = e.id AND i.automation_hold = true
            AND i.status IN ('Open', 'In Progress')) AS hold
      FROM epdr_endpoints e
      WHERE e.site_id = ${guard.activeSiteId}
        AND e.connection_id = ${binding?.connectionId ?? -1}
        AND e.account_revision = ${binding?.accountRevision ?? -1}
        AND e.removed_at IS NULL
      ORDER BY e.host_name ASC LIMIT 200`);

    const writeEnabled = disabledReasons.length === 0;
    return {
      writeEnabled,
      disabledReasons,
      approvalExpiryMinutes: settings.approvalExpiryMinutes,
      limits: {
        maxActionsPerHour: settings.maxActionsPerHour,
        cooldownMinutes: settings.executionCooldownMinutes,
        siteMaxActionsPerHour: settings.siteMaxActionsPerHour,
      },
      actions: writeEnabled
        ? actions.filter((entry) =>
            settings.globalAllowedActions.includes(entry.actionType) &&
            settings.siteAllowedActions.includes(entry.actionType))
        : [],
      endpoints: rows.map((row) => ({
        id: row.id,
        hostName: row.host_name,
        isolationState: row.isolation_state,
        hold: row.hold === true,
        dataFresh: row.fresh === true,
      })),
    };
  } catch {
    return error("service_unavailable");
  }
}

/** Map a shared snapshot failure onto the action's bounded error vocabulary. */
function snapshotError(result: { reason: string; detail?: string }): ExecutionError {
  switch (result.reason) {
    case "connection_unavailable": return error("connection_unavailable");
    case "action_not_allowed": return error("action_not_allowed");
    case "endpoint_unavailable": return error("endpoint_unavailable");
    case "target_unresolved":
    case "target_ambiguous": return error("target_unresolved", result.detail);
    default: return error("invalid_input", result.detail);
  }
}

/** Record an execution request. Never contacts the provider. */
export async function createEpdrExecutionRequest(input: unknown): Promise<{ requestId: number } | ExecutionError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");

  const actionType = parsed.data.actionType as WriteActionType;
  if (!(EXECUTABLE_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return error("action_not_allowed");
  }

  try {
    const settings = await loadExecutionSettings(guard.activeSiteId);
    if (!settings.globalWritesEnabled || !settings.siteWritesEnabled) return error("write_disabled");
    if (settings.globalKillSwitch || settings.siteKillSwitch) return error("blocked", "kill_switch");
    if (settings.automationPaused) return error("blocked", "automation_paused");
    if (!settings.globalAllowedActions.includes(actionType) || !settings.siteAllowedActions.includes(actionType)) {
      return error("action_not_allowed");
    }
    if (!(await hasWriteCredentials(guard.activeSiteId))) return error("credentials_missing");

    const expiresAt = Date.now() + settings.approvalExpiryMinutes * 60_000;
    const built = await buildExecutionSnapshot({
      siteId: guard.activeSiteId,
      endpointId: parsed.data.endpointId,
      actionType,
      parameters: parsed.data.parameters ?? {},
      requesterId: guard.session.userId,
      expiresAt,
    });
    if (!built.ok) return snapshotError(built);
    const snapshot = built.snapshot;

    const binding = await loadConnectionBinding(guard.activeSiteId);
    if (!binding) return error("connection_unavailable");
    const state = await loadEndpointExecutionState(guard.activeSiteId, binding.connectionId, parsed.data.endpointId);
    const recent = await countRecentRequests(guard.activeSiteId);
    const cooldown = await hasRecentDispatch(
      guard.activeSiteId, binding.connectionId, parsed.data.endpointId, actionType,
      settings.executionCooldownMinutes,
    );

    const decision = evaluateExecutionPolicy({
      stage: "request",
      nowMs: Date.now(),
      writeEnabled: settings.globalWritesEnabled && settings.siteWritesEnabled,
      globalKillSwitch: settings.globalKillSwitch,
      siteKillSwitch: settings.siteKillSwitch,
      automationPaused: settings.automationPaused,
      allowedActions: settings.globalAllowedActions,
      siteAllowedActions: settings.siteAllowedActions,
      connectionEnabled: binding.enabled,
      writeCredentialsPresent: true,
      currentAccountRevision: binding.accountRevision,
      currentCredentialRevision: binding.credentialRevision,
      currentEvidenceGeneration: state.evidenceGeneration,
      endpointPresent: state.endpointPresent,
      endpointRemoved: state.endpointRemoved,
      endpointHold: state.endpointHold,
      exclusionActive: state.exclusionActive,
      dataFresh: state.dataFresh,
      cooldownActive: cooldown,
      actionsLastHour: recent,
      maxActionsPerHour: settings.maxActionsPerHour,
      snapshot,
      // The active-site-admin guard just verified this actor.
      requesterId: guard.session.userId,
      requesterIsCurrentlyAuthorized: true,
    });
    if (!decision.allowed) return error("blocked", decision.reason);

    const intentKey = `${snapshot.namespace}:${executionIntentKey(snapshot)}`;
    try {
      const { rows } = await db.execute<{ id: number }>(sql`
        INSERT INTO epdr_actions
          (site_id, connection_id, endpoint_id, action_type, params, mode, state, idempotency_key,
           requested_by, snapshot, snapshot_hash, account_revision, credential_revision, evidence_generation,
           namespace, device_id, entity_id, provider_incident_id, approval_expires_at)
        VALUES (${guard.activeSiteId}, ${binding.connectionId}, ${parsed.data.endpointId}, ${actionType},
          ${JSON.stringify(snapshot.parameters)}::jsonb, 'approval', 'pending_approval', ${intentKey},
          ${guard.session.userId}, ${JSON.stringify(snapshot)}::jsonb, ${executionSnapshotHash(snapshot)},
          ${binding.accountRevision}, ${binding.credentialRevision}, ${state.evidenceGeneration},
          ${snapshot.namespace}, ${snapshot.target.deviceId}, ${snapshot.target.entityId},
          ${snapshot.target.providerIncidentId}, ${new Date(expiresAt)})
        RETURNING id`);
      const id = rows[0]?.id;
      if (!id) return error("service_unavailable");
      auditExecution("request", id, {
        actionType: snapshot.actionType, namespace: snapshot.namespace,
        endpointId: snapshot.target.endpointId, snapshotHash: executionSnapshotHash(snapshot),
      });
      return { requestId: id };
    } catch (insertError) {
      if ((insertError as { code?: string }).code === "23505") return error("duplicate_active_request");
      throw insertError;
    }
  } catch {
    return error("service_unavailable");
  }
}

type ActionRow = {
  id: number;
  state: string;
  action_type: string;
  endpoint_id: number;
  requested_by: number | null;
  approved_by: number | null;
  snapshot: unknown;
  snapshot_hash: string | null;
  approved_snapshot_hash: string | null;
  approval_expires_at: Date | null;
};

/**
 * Approve a request. The approver must be a *different* currently-authorized
 * site administrator, the snapshot must still match fresh state exactly, and
 * every gate is re-evaluated. Approval records a decision; it does not send.
 */
export async function approveEpdrExecutionRequest(input: unknown): Promise<{ state: "queued" } | ExecutionError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");

  try {
    return await db.transaction(async (tx) => {
      const { rows } = await tx.execute<ActionRow>(sql`
        SELECT id, state, action_type, endpoint_id, requested_by, approved_by, snapshot, snapshot_hash,
          approved_snapshot_hash, approval_expires_at
        FROM epdr_actions WHERE id = ${parsed.data.requestId} AND site_id = ${guard.activeSiteId}
          AND mode = 'approval' AND namespace IS NOT NULL FOR UPDATE`);
      const row = rows[0];
      if (!row) return error("not_found");
      if (row.state !== "pending_approval") return error("state_conflict");
      if (row.requested_by === guard.session.userId) return error("blocked", "self_approval");

      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);

      const settings = await loadExecutionSettings(guard.activeSiteId);
      if (!settings.globalWritesEnabled || !settings.siteWritesEnabled) return error("write_disabled");
      if (settings.globalKillSwitch || settings.siteKillSwitch) return error("blocked", "kill_switch");
      if (settings.automationPaused) return error("blocked", "automation_paused");
      if (!settings.globalAllowedActions.includes(row.action_type) || !settings.siteAllowedActions.includes(row.action_type)) {
        return error("action_not_allowed");
      }
      const binding = await loadConnectionBinding(guard.activeSiteId);
      if (!binding?.enabled) return error("connection_unavailable");
      const state = await loadEndpointExecutionState(guard.activeSiteId, binding.connectionId, row.endpoint_id);
      if (!state.endpointPresent) return error("endpoint_unavailable");
      if (!(await hasWriteCredentials(guard.activeSiteId))) return error("credentials_missing");

      const frozen = validateExecutionSnapshot(row.snapshot);
      if (!frozen.ok) return error("blocked", "snapshot_invalid");
      const snapshot = frozen.snapshot;
      if (executionSnapshotHash(snapshot) !== row.snapshot_hash) return error("blocked", "snapshot_invalid");

      const rebuilt = await buildExecutionSnapshot({
        siteId: guard.activeSiteId,
        endpointId: row.endpoint_id,
        actionType: row.action_type,
        parameters: snapshot.parameters,
        requesterId: snapshot.requesterId,
        expiresAt: snapshot.expiresAt,
      });
      if (!rebuilt.ok) return snapshotError(rebuilt);

      const nowMs = Date.now();
      const decision = evaluateExecutionPolicy({
        stage: "approve",
        nowMs,
        writeEnabled: true,
        globalKillSwitch: settings.globalKillSwitch,
        siteKillSwitch: settings.siteKillSwitch,
        automationPaused: settings.automationPaused,
        allowedActions: settings.globalAllowedActions,
        siteAllowedActions: settings.siteAllowedActions,
        connectionEnabled: binding.enabled,
        writeCredentialsPresent: true,
        currentAccountRevision: binding.accountRevision,
        currentCredentialRevision: binding.credentialRevision,
        currentEvidenceGeneration: state.evidenceGeneration,
        endpointPresent: state.endpointPresent,
        endpointRemoved: state.endpointRemoved,
        endpointHold: state.endpointHold,
        exclusionActive: state.exclusionActive,
        dataFresh: state.dataFresh,
        cooldownActive: await hasRecentDispatch(
          guard.activeSiteId, binding.connectionId, row.endpoint_id, row.action_type,
          settings.executionCooldownMinutes,
        ),
        actionsLastHour: await countRecentDispatches(guard.activeSiteId, binding.connectionId),
        maxActionsPerHour: settings.maxActionsPerHour,
        snapshot,
        // Enforced by the policy: approval is only valid while this matches.
        currentSnapshot: rebuilt.snapshot,
        // `assertReadSyncActor` above proved the approving administrator is still
        // an active site administrator; `isActiveSiteAdmin` proves the requester
        // still holds access to this site.
        approval: { approverId: guard.session.userId, approverIsCurrentSiteAdmin: true, expiresAt: snapshot.expiresAt },
        requesterId: guard.session.userId,
        requesterIsCurrentlyAuthorized: await isActiveSiteAdmin(guard.activeSiteId, snapshot.requesterId),
      });
      if (!decision.allowed) return error("blocked", decision.reason);

      // Never extend past the request's own window.
      const approvalExpiry = new Date(Math.min(nowMs + settings.approvalExpiryMinutes * 60_000, snapshot.expiresAt));
      const updated = await tx.execute(sql`
        UPDATE epdr_actions SET state = 'queued', approved_by = ${guard.session.userId},
          approved_at = clock_timestamp(), approved_snapshot_hash = snapshot_hash,
          approval_expires_at = ${approvalExpiry}, updated_at = clock_timestamp()
        WHERE id = ${row.id} AND site_id = ${guard.activeSiteId} AND state = 'pending_approval'
          AND approved_by IS NULL`);
      if ((updated.rowCount ?? 0) !== 1) return error("state_conflict");
      auditExecution("approve", row.id, {
        actionType: row.action_type, snapshotHash: row.snapshot_hash,
      });
      return { state: "queued" as const };
    });
  } catch {
    return error("service_unavailable");
  }
}

/** Reject a pending request. Never sends anything. */
export async function rejectEpdrExecutionRequest(input: unknown): Promise<{ state: "cancelled" } | ExecutionError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");
  try {
    const result = await db.execute(sql`
      UPDATE epdr_actions SET state = 'cancelled', cancelled_by = ${guard.session.userId}, updated_at = clock_timestamp()
      WHERE id = ${parsed.data.requestId} AND site_id = ${guard.activeSiteId}
        AND mode = 'approval' AND state IN ('pending_approval', 'queued')`);
    if ((result.rowCount ?? 0) !== 1) return error("state_conflict");
    auditExecution("reject", parsed.data.requestId);
    return { state: "cancelled" };
  } catch {
    return error("service_unavailable");
  }
}

/**
 * Cancel a request that has provably never been sent. A request already in
 * `dispatching` may have reached the provider, so it cannot be cancelled here.
 */
export async function cancelEpdrExecutionRequest(input: unknown): Promise<{ state: "cancelled" } | ExecutionError> {
  return rejectEpdrExecutionRequest(input);
}

const resolveSchema = z.object({
  requestId: z.number().int().positive(),
  note: z.string().trim().min(3).max(200),
  confirmResolve: z.literal(true),
}).strict();

/**
 * Close a request that observation sent to `needs_review`.
 *
 * This is the only way out of `needs_review`. It records the operator's note
 * and releases the active-intent uniqueness so a deliberate retry can be
 * requested later. It never claims the provider did or did not perform the
 * operation.
 */
export async function resolveEpdrExecutionReview(input: unknown): Promise<{ state: "cancelled" } | ExecutionError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");
  try {
    const updated = await db.execute(sql`
      UPDATE epdr_actions SET state = 'cancelled', review_reason = ${parsed.data.note},
        updated_at = clock_timestamp()
      WHERE id = ${parsed.data.requestId} AND site_id = ${guard.activeSiteId}
        AND mode = 'approval' AND namespace IS NOT NULL AND state = 'needs_review'`);
    if ((updated.rowCount ?? 0) !== 1) return error("state_conflict");
    auditExecution("resolve_review", parsed.data.requestId, { note: parsed.data.note });
    return { state: "cancelled" };
  } catch {
    return error("service_unavailable");
  }
}

export type ExecutionRequestSummary = {
  id: number;
  actionType: string;
  state: string;
  endpointId: number;
  stateHint: string;
  createdAt: string;
  approvedAt: string | null;
  approvalExpiresAt: string | null;
  outcomeUnknownReason: string | null;
};

const listSchema = z.object({ page: z.number().int().min(1).max(10_000).optional() }).strict();
const PAGE_SIZE = 25;

export async function getEpdrExecutionRequests(input: unknown = {}): Promise<
  { rows: ExecutionRequestSummary[]; page: number; pages: number; total: number } | ExecutionError
> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");
  try {
    const { rows: counts } = await db.execute<{ total: number }>(sql`
      SELECT count(*)::integer AS total FROM epdr_actions
      WHERE site_id = ${guard.activeSiteId} AND mode = 'approval' AND namespace IS NOT NULL`);
    const total = Number(counts[0]?.total ?? 0);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(parsed.data.page ?? 1, pages);
    const { rows } = await db.execute<{
      id: number; action_type: string; state: string; endpoint_id: number; created_at: Date;
      approved_at: Date | null; approval_expires_at: Date | null; outcome_unknown_reason: string | null;
    }>(sql`
      SELECT id, action_type, state, endpoint_id, created_at, approved_at, approval_expires_at, outcome_unknown_reason
      FROM epdr_actions WHERE site_id = ${guard.activeSiteId} AND mode = 'approval' AND namespace IS NOT NULL
      ORDER BY id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`);
    return {
      page,
      pages,
      total,
      rows: rows.map((row) => ({
        id: row.id,
        actionType: row.action_type,
        state: row.state,
        endpointId: row.endpoint_id,
        stateHint: row.outcome_unknown_reason ?? "",
        createdAt: new Date(row.created_at).toISOString(),
        approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
        approvalExpiresAt: row.approval_expires_at ? new Date(row.approval_expires_at).toISOString() : null,
        outcomeUnknownReason: row.outcome_unknown_reason,
      })),
    };
  } catch {
    return error("service_unavailable");
  }
}

export type ExecutionRequestDetail = ExecutionRequestSummary & {
  requestedBy: number | null;
  approvedBy: number | null;
  snapshotHash: string | null;
  parameters: unknown;
  providerRef: string | null;
  namespace: string | null;
  /** Exact frozen target the approver is being asked to authorize. */
  target: {
    deviceId: string | null;
    entityId: string | null;
    providerIncidentId: string | null;
  };
  accountRevision: number | null;
  credentialRevision: number | null;
  evidenceGeneration: number | null;
  expiresAt: string | null;
  reviewReason: string | null;
  attempts: { attempt: number; phase: string; status: string; responseStatus: number | null; startedAt: string }[];
};

export async function getEpdrExecutionRequest(requestId: number): Promise<ExecutionRequestDetail | ExecutionError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  if (!Number.isSafeInteger(requestId) || requestId < 1) return error("invalid_input");
  try {
    const { rows } = await db.execute<{
      id: number; action_type: string; state: string; endpoint_id: number; created_at: Date;
      approved_at: Date | null; approval_expires_at: Date | null; outcome_unknown_reason: string | null;
      requested_by: number | null; approved_by: number | null; snapshot_hash: string | null;
      params: unknown; provider_ref: string | null; namespace: string | null; snapshot: unknown;
      account_revision: number; credential_revision: number; evidence_generation: number;
      review_reason: string | null;
    }>(sql`
      SELECT id, action_type, state, endpoint_id, created_at, approved_at, approval_expires_at,
        outcome_unknown_reason, requested_by, approved_by, snapshot_hash, params, provider_ref,
        namespace, snapshot, account_revision, credential_revision, evidence_generation, review_reason
      FROM epdr_actions WHERE id = ${requestId} AND site_id = ${guard.activeSiteId}
        AND mode = 'approval' AND namespace IS NOT NULL LIMIT 1`);
    const row = rows[0];
    if (!row) return error("not_found");
    const frozen = validateExecutionSnapshot(row.snapshot);
    const { rows: attempts } = await db.execute<{
      attempt: number; phase: string; status: string; response_status: number | null; started_at: Date;
    }>(sql`SELECT attempt, phase, status, response_status, started_at FROM epdr_attempts
      WHERE action_id = ${requestId} ORDER BY attempt ASC LIMIT 50`);
    return {
      id: row.id,
      actionType: row.action_type,
      state: row.state,
      endpointId: row.endpoint_id,
      stateHint: row.outcome_unknown_reason ?? "",
      createdAt: new Date(row.created_at).toISOString(),
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      approvalExpiresAt: row.approval_expires_at ? new Date(row.approval_expires_at).toISOString() : null,
      outcomeUnknownReason: row.outcome_unknown_reason,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by,
      snapshotHash: row.snapshot_hash,
      parameters: row.params,
      providerRef: row.provider_ref,
      namespace: row.namespace,
      target: frozen.ok
        ? {
            deviceId: frozen.snapshot.target.deviceId,
            entityId: frozen.snapshot.target.entityId,
            providerIncidentId: frozen.snapshot.target.providerIncidentId,
          }
        : { deviceId: null, entityId: null, providerIncidentId: null },
      accountRevision: row.account_revision,
      credentialRevision: row.credential_revision,
      evidenceGeneration: row.evidence_generation,
      expiresAt: frozen.ok ? new Date(frozen.snapshot.expiresAt).toISOString() : null,
      reviewReason: row.review_reason,
      attempts: attempts.map((attempt) => ({
        attempt: attempt.attempt,
        phase: attempt.phase,
        status: attempt.status,
        responseStatus: attempt.response_status,
        startedAt: new Date(attempt.started_at).toISOString(),
      })),
    };
  } catch {
    return error("service_unavailable");
  }
}
