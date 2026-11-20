/**
 * Provider write dispatch and observation jobs.
 *
 * Dispatch path:
 *   queued → (revalidate every gate against fresh state) → claim transaction
 *   (state=dispatching, generation+1, attempt row committed) → one HTTP request
 *   outside any transaction → generation-fenced publish.
 *
 * A timeout, a 5xx, a lost response, or a worker crash after the claim leaves
 * the request ambiguous. It is published as `outcome_unknown` and is never
 * re-sent; observation resolves it.
 *
 * Observation path reads provider state only. It keeps running while a kill
 * switch is active, because stopping new sends must not stop resolving requests
 * that may already have been performed.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveWatchGuardConnection } from "@/lib/watchguard/connection";
import { createWatchGuardClient } from "@/lib/watchguard/client";
import { createWatchGuardWriteTransport } from "@/lib/watchguard/write-client";
import { getWriteOperation, type WriteActionType } from "./execution-capability";
import {
  aggregateScanJobStatuses,
  classifyDispatchResponse,
  matchesScanTaskMarker,
  type DispatchClassification,
} from "./execution-dispatch";
import { runExecutionDispatch, runExecutionObservation, type ClaimedDispatch } from "./execution-engine";
import { buildWriteBody } from "./execution-payload";
import { evaluateExecutionPolicy } from "./execution-policy";
import {
  executionSnapshotHash,
  validateExecutionSnapshot,
  type ExecutionSnapshot,
} from "./execution-request";
import { classifyIsolationState, interpretIncidentStatusMatch, interpretThreatSyncStatus } from "./execution-reconcile";
import { buildExecutionSnapshot } from "./execution-snapshot";
import {
  DEFAULT_EXECUTION_COOLDOWN_MINUTES,
  countRecentDispatches,
  hasRecentDispatch,
  hasWriteCredentials,
  isActiveSiteAdmin,
  loadConnectionBinding,
  loadEndpointExecutionState,
  loadExecutionSettings,
} from "./execution-store";

const LEASE_SECONDS = 90;
const OBSERVE_INITIAL_DELAY_SECONDS = 45;
const OBSERVE_MAX_ATTEMPTS = 12;
const OBSERVE_DEADLINE_MINUTES = 90;
const TASK_LOOKBACK = 100;

/**
 * Blocks that will clear on their own. The request stays queued and is retried
 * on a later pass; it is not pushed to manual review for a temporary condition.
 */
const TRANSIENT_DISPATCH_BLOCKS = new Set([
  "cooldown_active", "rate_limited", "automation_paused",
  "global_kill_switch", "site_kill_switch", "write_not_enabled",
]);

export type DispatchPassSummary = { sent: number; failed: number; unknown: number; skipped: number };
export type ObservePassSummary = { verified: number; failed: number; running: number; review: number; skipped: number };

type ClaimRow = {
  id: number;
  action_type: string;
  endpoint_id: number;
  snapshot: unknown;
  snapshot_hash: string | null;
  approved_by: number | null;
  approval_expires_at: Date | null;
  generation: number;
  request_generation: number;
};

type ClaimedWork = ClaimedDispatch & {
  snapshot: ExecutionSnapshot;
  actionType: string;
  endpointId: number;
  hostName: string | null;
};

/**
 * Revalidate every gate against freshly loaded state, after the claim. A
 * request whose snapshot no longer matches current state is moved to
 * `needs_review` rather than sent: the administrator approved something that is
 * no longer true. This is also the narrow pre-send re-check: kill switch, pause
 * or enablement flipping *after* the claim aborts the send attempt.
 */
async function revalidateForDispatch(row: ClaimRow, siteId: number, connectionId: number): Promise<
  { ok: true; snapshot: ExecutionSnapshot } | { ok: false; reason: string }
> {
  const frozen = validateExecutionSnapshot(row.snapshot);
  if (!frozen.ok) return { ok: false, reason: "snapshot_invalid" };
  const snapshot = frozen.snapshot;
  if (executionSnapshotHash(snapshot) !== row.snapshot_hash) return { ok: false, reason: "snapshot_invalid" };

  const settings = await loadExecutionSettings(siteId);
  if (!settings.globalWritesEnabled || !settings.siteWritesEnabled) return { ok: false, reason: "write_not_enabled" };
  const binding = await loadConnectionBinding(siteId);
  if (!binding || binding.connectionId !== connectionId) return { ok: false, reason: "connection_changed" };
  if (!(await hasWriteCredentials(siteId))) return { ok: false, reason: "write_credentials_missing" };

  // Rebuild the exact snapshot from current state. The hash comparison below is
  // what makes "approved target" equal "sent target"; comparing the frozen
  // snapshot with itself (the previous implementation) proved nothing.
  const rebuilt = await buildExecutionSnapshot({
    siteId,
    endpointId: row.endpoint_id,
    actionType: row.action_type,
    parameters: snapshot.parameters,
    requesterId: snapshot.requesterId,
    expiresAt: snapshot.expiresAt,
  });
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason };
  if (executionSnapshotHash(rebuilt.snapshot) !== row.snapshot_hash) {
    return { ok: false, reason: "snapshot_changed" };
  }

  const state = await loadEndpointExecutionState(siteId, connectionId, row.endpoint_id);
  // Drizzle's raw execute returns timestamptz as a string, never as a Date —
  // parse defensively so both shapes work.
  const approvalExpiresMs = row.approval_expires_at === null
    ? null
    : new Date(row.approval_expires_at as unknown as string | Date).getTime();
  const decision = evaluateExecutionPolicy({
    stage: "dispatch",
    nowMs: Date.now(),
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
    // This claim is the reservation itself: exclude its own attempt row so the
    // just-committed claim cannot trip its own cooldown or cap.
    cooldownActive: await hasRecentDispatch(siteId, connectionId, row.endpoint_id, row.action_type, settings.executionCooldownMinutes, row.id),
    actionsLastHour: await countRecentDispatches(siteId, connectionId, row.id),
    maxActionsPerHour: settings.maxActionsPerHour,
    snapshot,
    currentSnapshot: rebuilt.snapshot,
    approval: row.approved_by === null || approvalExpiresMs === null
      ? null
      : {
          approverId: row.approved_by,
          approverIsCurrentSiteAdmin: await isActiveSiteAdmin(siteId, row.approved_by),
          expiresAt: approvalExpiresMs,
        },
    requesterId: snapshot.requesterId,
    requesterIsCurrentlyAuthorized: await isActiveSiteAdmin(siteId, snapshot.requesterId),
    terminal: false,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  return { ok: true, snapshot: rebuilt.snapshot };
}

/**
 * Append an attempt lifecycle event. Best-effort outside a publishing
 * transaction: the attempt row and action state remain the authoritative
 * record when the ledger insert loses a race with a crash.
 */
async function recordAttemptEvent(
  actionId: number,
  attemptNumber: number,
  phase: string,
  event: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
      VALUES (${actionId}, ${attemptNumber}, ${phase}, ${event}, ${JSON.stringify(detail)}::jsonb)`);
  } catch {
    // The ledger must never break dispatch or observation.
  }
}

/**
 * Undo a claim that will not reach the provider. A transient reason returns the
 * request to `queued` (it stays dispatchable on a later pass); anything else
 * goes to `needs_review`. The attempt row records `aborted` and `dispatched_at`
 * is cleared: nothing was sent, so no cooldown may attach to this endpoint.
 */
async function abortClaim(
  siteId: number,
  actionId: number,
  generation: number,
  attemptNumber: number,
  reason: string,
  transient: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE epdr_actions SET state = ${transient ? "queued" : "needs_review"},
        review_reason = ${transient ? null : reason},
        dispatched_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp()
      WHERE id = ${actionId} AND site_id = ${siteId} AND state = 'dispatching'
        AND generation = ${generation}`);
    await tx.execute(sql`
      UPDATE epdr_attempts SET status = 'aborted', error = ${reason}
      WHERE action_id = ${actionId} AND attempt = ${attemptNumber} AND phase = 'dispatch'`);
    await tx.execute(sql`
      INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
      VALUES (${actionId}, ${attemptNumber}, 'dispatch', 'aborted',
        ${JSON.stringify({ reason, transient })}::jsonb)`);
  });
}

/**
 * Reserve the next dispatchable request atomically against the site's limits.
 *
 * One short transaction does everything the reservation depends on:
 * - the connection row is locked (`FOR UPDATE`), serializing dispatchers for
 *   this site — the same per-site mutex the read-sync queue uses;
 * - the effective limits (`LEAST(site, global)`) are read from that locked row;
 * - the hourly cap counts only committed attempt rows;
 * - the candidate claim uses a cooldown anti-join (a cooled-down endpoint
 *   cannot block the queue head) and `FOR UPDATE SKIP LOCKED` (two workers
 *   never claim the same request);
 * - the attempt row and its `claimed` event commit with the claim, before any
 *   network I/O.
 *
 * Gate/snapshot revalidation runs *after* the transaction so the lock is held
 * only for the reservation itself.
 */
export async function claimNextDispatch(
  siteId: number,
  connectionId: number,
  workerId: string,
): Promise<ClaimedWork | null> {
  const claimed = await db.transaction(async (tx): Promise<
    { candidate: ClaimRow; generation: number; attemptNumber: number } | null
  > => {
    // Per-site mutex + effective limits, read from the locked connection row.
    const { rows: limitRows } = await tx.execute<{
      site_id: number; cap: number; cooldown_minutes: number; gates_open: boolean;
    }>(sql`
      SELECT c.site_id,
        least(coalesce(s.max_actions_per_hour, g.max_actions_per_hour_per_site), g.max_actions_per_hour_per_site) AS cap,
        coalesce(s.execution_cooldown_minutes, ${DEFAULT_EXECUTION_COOLDOWN_MINUTES}) AS cooldown_minutes,
        (g.provider_writes_enabled AND s.provider_writes_enabled
          AND NOT g.kill_switch AND NOT s.site_kill_switch
          AND s.automation_paused_at IS NULL) AS gates_open
      FROM watchguard_connections c
      LEFT JOIN watchguard_global_settings g ON g.id = 1
      LEFT JOIN epdr_site_settings s ON s.site_id = c.site_id
      WHERE c.id = ${connectionId}
      FOR UPDATE OF c`);
    const limits = limitRows[0];
    if (!limits || limits.gates_open !== true) return null;

    const { rows: usedRows } = await tx.execute<{ used: number }>(sql`
      SELECT count(*)::integer AS used FROM epdr_attempts a
      JOIN epdr_actions x ON x.id = a.action_id
      WHERE x.connection_id = ${connectionId} AND a.phase = 'dispatch'
        AND a.started_at > clock_timestamp() - interval '1 hour'`);
    if (Number(usedRows[0]?.used ?? 0) >= Number(limits.cap)) return null;

    const cooldownMinutes = Math.max(0, Math.floor(Number(limits.cooldown_minutes)));
    const { rows: candidates } = await tx.execute<ClaimRow>(sql`
      SELECT x.id, x.action_type, x.endpoint_id, x.snapshot, x.snapshot_hash, x.approved_by,
        x.approval_expires_at, x.generation
      FROM epdr_actions x
      WHERE x.site_id = ${Number(limits.site_id)} AND x.connection_id = ${connectionId}
        AND x.mode = 'approval' AND x.state = 'queued' AND x.namespace IS NOT NULL
        AND x.approved_by IS NOT NULL AND x.approved_snapshot_hash IS NOT NULL
        AND x.approval_expires_at > clock_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM epdr_actions prev
          WHERE prev.connection_id = x.connection_id AND prev.endpoint_id = x.endpoint_id
            AND prev.action_type = x.action_type AND prev.dispatched_at IS NOT NULL
            AND prev.dispatched_at > clock_timestamp() - interval '${sql.raw(String(cooldownMinutes))} minutes'
        )
      ORDER BY x.id ASC
      FOR UPDATE OF x SKIP LOCKED
      LIMIT 1`);
    const candidate = candidates[0];
    if (!candidate) return null;

    const { rows: claimedRows } = await tx.execute<{ generation: number; attempt: number }>(sql`
      UPDATE epdr_actions SET state = 'dispatching', generation = generation + 1,
        lease_owner = ${workerId}, lease_expires_at = clock_timestamp() + interval '${sql.raw(String(LEASE_SECONDS))} seconds',
        attempt = attempt + 1, dispatched_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = ${candidate.id} AND site_id = ${Number(limits.site_id)} AND state = 'queued'
        AND approved_by IS NOT NULL AND approved_snapshot_hash = snapshot_hash
        AND approval_expires_at > clock_timestamp()
      RETURNING generation, attempt`);
    const generation = claimedRows[0]?.generation;
    const attemptNumber = claimedRows[0]?.attempt;
    if (generation === undefined || attemptNumber === undefined) return null;
    // `attempt` is one monotonic counter shared by dispatch and observation, so
    // the ledger row can never collide with a later status read.
    await tx.execute(sql`
      INSERT INTO epdr_attempts (action_id, attempt, started_at, status, phase, snapshot_hash)
      VALUES (${candidate.id}, ${attemptNumber}, clock_timestamp(), 'sending', 'dispatch', ${candidate.snapshot_hash})`);
    await tx.execute(sql`
      INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
      VALUES (${candidate.id}, ${attemptNumber}, 'dispatch', 'claimed',
        ${JSON.stringify({ workerId, cooldownMinutes, cap: Number(limits.cap) })}::jsonb)`);
    return { candidate, generation, attemptNumber };
  });
  if (!claimed) return null;

  const { candidate, generation, attemptNumber } = claimed;
  const validated = await revalidateForDispatch(candidate, siteId, connectionId);
  if (!validated.ok) {
    await abortClaim(siteId, candidate.id, generation, attemptNumber, validated.reason,
      TRANSIENT_DISPATCH_BLOCKS.has(validated.reason));
    return null;
  }

  const binding = await loadConnectionBinding(siteId);
  const state = binding
    ? await loadEndpointExecutionState(siteId, binding.connectionId, candidate.endpoint_id)
    : null;
  return {
    actionId: candidate.id,
    generation,
    attemptNumber,
    snapshotHash: candidate.snapshot_hash ?? "",
    snapshot: validated.snapshot,
    actionType: candidate.action_type,
    endpointId: candidate.endpoint_id,
    hostName: state?.hostName ?? null,
  } satisfies ClaimedWork;
}

/** Publish a classified dispatch outcome under the generation fence. */
async function finalizeDispatch(
  siteId: number,
  claimed: ClaimedWork,
  outcome: DispatchClassification,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const nextState = outcome.kind === "accepted" ? "in_progress"
      : outcome.kind === "definite_reject" ? "failed"
      : "outcome_unknown";
    const reason = outcome.kind === "accepted" ? null : outcome.reason;

    const { rows } = await tx.execute<{ id: number }>(sql`
      UPDATE epdr_actions SET state = ${nextState},
        provider_ref = ${outcome.kind === "accepted" ? outcome.providerRef : null},
        provider_job_id = ${outcome.kind === "accepted" ? outcome.providerJobId : null},
        affected_items = ${outcome.kind === "accepted" ? outcome.affectedItems : null},
        result = ${outcome.kind === "accepted" ? JSON.stringify({ receipt: outcome.response }) : null}::jsonb,
        outcome_unknown_reason = ${nextState === "outcome_unknown" ? reason : null},
        last_error_kind = ${outcome.kind === "definite_reject" ? reason : null},
        lease_owner = NULL, lease_expires_at = NULL,
        observe_after = ${nextState === "in_progress"
          ? sql.raw(`clock_timestamp() + interval '${OBSERVE_INITIAL_DELAY_SECONDS} seconds'`)
          : null},
        deadline_at = ${nextState === "in_progress" || nextState === "outcome_unknown"
          ? sql.raw(`coalesce(deadline_at, clock_timestamp() + interval '${OBSERVE_DEADLINE_MINUTES} minutes')`)
          : sql`deadline_at`},
        updated_at = clock_timestamp()
      WHERE id = ${claimed.actionId} AND site_id = ${siteId} AND state = 'dispatching'
        AND generation = ${claimed.generation}
      RETURNING id`);
    if (!rows[0]) return false;

    await tx.execute(sql`
      UPDATE epdr_attempts SET status = ${outcome.kind === "accepted" ? "accepted" : outcome.kind === "definite_reject" ? "rejected" : "ambiguous"},
        error = ${reason},
        response = ${outcome.kind === "accepted" ? JSON.stringify(outcome.response) : null}::jsonb
      WHERE action_id = ${claimed.actionId} AND attempt = ${claimed.attemptNumber}`);
    // Lifecycle events commit with the state they describe; the `sent` event is
    // written by the send path, which knows the HTTP call actually happened.
    if (outcome.kind === "accepted") {
      await tx.execute(sql`
        INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
        VALUES (${claimed.actionId}, ${claimed.attemptNumber}, 'dispatch', 'accepted',
          ${JSON.stringify({ providerRef: outcome.providerRef ?? null, providerJobId: outcome.providerJobId ?? null })}::jsonb)`);
    } else if (outcome.kind === "outcome_unknown") {
      await tx.execute(sql`
        INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
        VALUES (${claimed.actionId}, ${claimed.attemptNumber}, 'dispatch', 'ambiguous',
          ${JSON.stringify({ reason })}::jsonb)`);
    }
    return true;
  });
}

/** Send at most `limit` approved requests for one site. */
export async function runProviderDispatchPass(
  connectionId: number,
  options: { limit?: number; workerId?: string; transport?: ReturnType<typeof createWatchGuardWriteTransport> } = {},
): Promise<DispatchPassSummary> {
  const summary: DispatchPassSummary = { sent: 0, failed: 0, unknown: 0, skipped: 0 };
  const { rows } = await db.execute<{ site_id: number }>(
    sql`SELECT site_id FROM watchguard_connections WHERE id = ${connectionId} AND enabled = true LIMIT 1`);
  const siteId = rows[0]?.site_id;
  if (!siteId) return summary;

  const settings = await loadExecutionSettings(siteId);
  // Stop new sends while a kill switch is active; observation keeps running.
  if (!settings.globalWritesEnabled || !settings.siteWritesEnabled) return summary;
  if (settings.globalKillSwitch || settings.siteKillSwitch) return summary;
  if (settings.automationPaused) return summary;

  // Approvals that lapsed while queued would never clear on their own; the
  // sweep closes them so the queue reflects only currently-authorized work.
  await expireExpiredApprovals(connectionId);

  const resolved = await resolveWatchGuardConnection(siteId, { mode: "write" });
  if (!resolved.ok) return summary;

  const transport = options.transport ?? createWatchGuardWriteTransport();
  const workerId = options.workerId ?? `worker:${process.pid}`;
  const limit = options.limit ?? 5;

  for (let index = 0; index < limit; index++) {
    const claimed = await claimNextDispatch(siteId, connectionId, workerId);
    if (!claimed) break;

    const operation = getWriteOperation(claimed.snapshot.namespace, claimed.actionType);
    if (!operation) {
      await finalizeDispatch(siteId, claimed, { kind: "definite_reject", reason: "operation_not_verified" });
      summary.failed++;
      continue;
    }

    // Credentials were resolved before the loop. If they rotated between claims,
    // stop rather than sending with a stale secret. No provider call is made.
    if (claimed.snapshot.credentialRevision !== resolved.credentialRevision) {
      await finalizeDispatch(siteId, claimed, { kind: "definite_reject", reason: "credential_changed" });
      summary.failed++;
      continue;
    }

    const body = buildWriteBody(operation, claimed.snapshot, {
      requestId: claimed.actionId,
      hostName: claimed.hostName,
    });
    if (!body.ok) {
      await finalizeDispatch(siteId, claimed, { kind: "definite_reject", reason: body.reason });
      summary.failed++;
      continue;
    }

    const outcome = await runExecutionDispatch({
      claim: async () => claimed,
      send: async (work) => {
        const current = work as ClaimedWork;
        const result = await transport.send({
          credentials: resolved.credentials,
          operation,
          pathParams: body.pathParams,
          body: body.body,
          enabled: true,
          credentialMode: "write",
          credentialRevision: resolved.credentialRevision,
        });
        // The HTTP round trip completed; record it before classification so the
        // ledger shows the send even if publishing later loses the fence.
        await recordAttemptEvent(current.actionId, current.attemptNumber, "dispatch", "sent", {});
        if (result.kind === "blocked") return { kind: "definite_reject", reason: result.reason };
        if (result.kind === "timed_out") return { kind: "outcome_unknown", reason: "client_timeout" };
        if (result.kind === "network_error") return { kind: "outcome_unknown", reason: "network_error" };
        return classifyDispatchResponse({
          operation,
          status: result.status,
          body: result.body,
          expectedDeviceId: current.snapshot.target.deviceId,
        });
      },
      finalize: (work, classified) => finalizeDispatch(siteId, work as ClaimedWork, classified),
    });

    if (outcome.result === "sent") summary.sent++;
    else if (outcome.result === "definite_failed") summary.failed++;
    else if (outcome.result === "outcome_unknown") summary.unknown++;
    else summary.skipped++;
  }

  return summary;
}

type ObserveRow = {
  id: number;
  action_type: string;
  endpoint_id: number;
  state: string;
  account_revision: number;
  provider_ref: string | null;
  provider_incident_id: string | null;
  namespace: string | null;
  generation: number;
  attempt: number;
  observe_attempts: number;
  observe_after: Date | null;
  deadline_at: Date | null;
  params: unknown;
};

/**
 * Resolve requests that were accepted by the provider. This pass performs
 * reads only, and it keeps running while a kill switch is active.
 */
export async function runProviderObservePass(
  connectionId: number,
  options: { limit?: number; workerId?: string } = {},
): Promise<ObservePassSummary> {
  const summary: ObservePassSummary = { verified: 0, failed: 0, running: 0, review: 0, skipped: 0 };
  const { rows: sites } = await db.execute<{ site_id: number }>(
    sql`SELECT site_id FROM watchguard_connections WHERE id = ${connectionId} LIMIT 1`);
  const siteId = sites[0]?.site_id;
  if (!siteId) return summary;

  // Observation is read-only and must keep resolving requests after the
  // connection is disabled or a kill switch is raised.
  const binding = await loadConnectionBinding(siteId);
  if (!binding || binding.connectionId !== connectionId) return summary;
  const resolved = await resolveWatchGuardConnection(siteId, { mode: "read", allowDisabled: true });
  if (!resolved.ok) return summary;
  const client = createWatchGuardClient(resolved.credentials, { credentialRevision: resolved.credentialRevision });

  await expireExhaustedObservations(connectionId);

  const limit = options.limit ?? 5;
  for (let index = 0; index < limit; index++) {
    // Candidate selection and claim commit in one transaction: `FOR UPDATE SKIP
    // LOCKED` keeps concurrent workers from spinning on the same row.
    const claimed = await db.transaction(async (tx): Promise<
      | { kind: "empty" }
      | { kind: "revision_changed"; actionId: number }
      | { kind: "claimed"; row: ObserveRow; generation: number; attemptNumber: number; previousState: string }
    > => {
      const { rows } = await tx.execute<ObserveRow>(sql`
        SELECT id, action_type, endpoint_id, state, account_revision, provider_ref, provider_incident_id, namespace, generation,
          attempt, observe_attempts, observe_after, deadline_at, params
        FROM epdr_actions
        WHERE site_id = ${siteId} AND connection_id = ${connectionId}
          AND mode = 'approval' AND namespace IS NOT NULL
          AND state IN ('in_progress', 'outcome_unknown')
          AND observe_attempts < ${OBSERVE_MAX_ATTEMPTS}
          AND (observe_after IS NULL OR observe_after <= clock_timestamp())
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`);
      const row = rows[0];
      if (!row) return { kind: "empty" };

      // Never read an old account's provider id with the current credentials.
      if (Number(row.account_revision) !== binding.accountRevision) {
        await tx.execute(sql`
          UPDATE epdr_actions SET state = 'needs_review', review_reason = 'account_revision_changed',
            lease_owner = NULL, updated_at = clock_timestamp()
          WHERE id = ${row.id} AND site_id = ${siteId} AND state IN ('in_progress', 'outcome_unknown')`);
        return { kind: "revision_changed", actionId: row.id };
      }

      const { rows: claimedRows } = await tx.execute<{ generation: number; attempt: number }>(sql`
        UPDATE epdr_actions SET generation = generation + 1, attempt = attempt + 1,
          observe_attempts = observe_attempts + 1,
          lease_owner = ${options.workerId ?? `worker:${process.pid}`},
          lease_expires_at = clock_timestamp() + interval '${sql.raw(String(LEASE_SECONDS))} seconds',
          updated_at = clock_timestamp()
        WHERE id = ${row.id} AND site_id = ${siteId} AND generation = ${row.generation}
          AND state IN ('in_progress', 'outcome_unknown')
        RETURNING generation, attempt`);
      const generation = claimedRows[0]?.generation;
      const attemptNumber = claimedRows[0]?.attempt;
      if (generation === undefined || attemptNumber === undefined) return { kind: "empty" };
      await tx.execute(sql`
        INSERT INTO epdr_attempts (action_id, attempt, started_at, status, phase)
        VALUES (${row.id}, ${attemptNumber}, clock_timestamp(), 'observing', 'observe')`);
      await tx.execute(sql`
        INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
        VALUES (${row.id}, ${attemptNumber}, 'observe', 'claimed',
          ${JSON.stringify({ workerId: options.workerId ?? `worker:${process.pid}` })}::jsonb)`);
      return { kind: "claimed", row, generation, attemptNumber, previousState: row.state };
    });
    if (claimed.kind === "empty") break;
    if (claimed.kind === "revision_changed") {
      summary.review++;
      continue;
    }
    const row = claimed.row;

    const outcome = await runExecutionObservation({
      claim: async () => ({
        actionId: row.id,
        generation: claimed.generation,
        namespace: row.namespace ?? "endpoint_security",
        actionType: row.action_type,
        providerRef: row.provider_ref,
        providerIncidentId: row.provider_incident_id,
        attemptNumber: claimed.attemptNumber,
      }),
      observe: async () => {
        try {
          if ((row.namespace ?? "endpoint_security") === "endpoint_security" && row.action_type === "scan") {
            return await observeScan(client, row);
          }
          if ((row.namespace ?? "endpoint_security") === "threatsync") {
            return await observeThreatSyncAction(client, row);
          }
          return await observeEndpointState(client, row);
        } catch {
          return { kind: "unreadable" as const };
        }
      },
      finalize: async (work, decision) => db.transaction(async (tx) => {
        const deadlineMs = row.deadline_at ? new Date(row.deadline_at).getTime() : null;
        const overdue = deadlineMs !== null && Date.now() >= deadlineMs && decision.kind !== "finished";
        // A single transient read failure should not require manual review when
        // the budget still allows another read. ThreatSync observations follow
        // the same bounded retry: their reads are supported, an unreadable
        // value just means the provider reported something unmapped.
        const transient = decision.kind === "unreadable"
          && Number(row.observe_attempts) + 1 < 3;
        const nextState = overdue
          ? "needs_review"
          : decision.kind === "finished"
            ? (decision.outcome === "completed" ? "completed" : "failed")
            // A request that was never confirmed accepted must not become
            // `in_progress` just because a read found no evidence yet.
            : decision.kind === "still_running"
              ? (claimed.previousState === "outcome_unknown" ? "outcome_unknown" : "in_progress")
              : transient
                ? claimed.previousState
                : "needs_review";
        const reason = overdue
          ? "observation_deadline_exceeded"
          : decision.kind === "unreadable"
            ? (transient ? "status_unreadable_retry" : "status_unreadable")
            : decision.kind === "still_running" && claimed.previousState === "outcome_unknown"
              ? "not_found_yet"
              : null;
        const { rows: updated } = await tx.execute<{ id: number }>(sql`
          UPDATE epdr_actions SET state = ${nextState},
            observed_at = clock_timestamp(), lease_owner = NULL, lease_expires_at = NULL,
            outcome_unknown_reason = ${nextState === "outcome_unknown" ? reason : null},
            observe_after = ${nextState === "in_progress" || nextState === "outcome_unknown" || transient
              ? sql.raw(`clock_timestamp() + interval '60 seconds'`)
              : null},
            review_reason = ${reason},
            deadline_at = coalesce(deadline_at, clock_timestamp() + interval '${sql.raw(String(OBSERVE_DEADLINE_MINUTES))} minutes'),
            updated_at = clock_timestamp()
          WHERE id = ${row.id} AND site_id = ${siteId} AND generation = ${work.generation}
          RETURNING id`);
        if (!updated[0]) return false;
        await tx.execute(sql`
          UPDATE epdr_attempts SET status = ${overdue ? "deadline_exceeded" : transient ? "retrying" : decision.kind},
            error = ${reason}
          WHERE action_id = ${row.id} AND attempt = ${work.attemptNumber}`);
        await tx.execute(sql`
          INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
          VALUES (${row.id}, ${work.attemptNumber}, 'observe', 'observed',
            ${JSON.stringify({ decision: decision.kind, state: nextState, reason })}::jsonb)`);
        return true;
      }),
    });

    if (outcome.result === "verified") summary.verified++;
    else if (outcome.result === "failed") summary.failed++;
    else if (outcome.result === "still_running") summary.running++;
    else if (outcome.result === "needs_review") summary.review++;
    else summary.skipped++;
  }

  return summary;
}

/**
 * Scan observation: find the task carrying this request's exact marker, then
 * aggregate every job status. Zero matches stay unresolved because visibility
 * can lag; they never imply acceptance.
 */
async function observeScan(
  client: ReturnType<typeof createWatchGuardClient>,
  row: ObserveRow,
) {
  const page = await client.listTasks({ top: TASK_LOOKBACK });
  // The schema normalizes the live `id`/`name` fields to `task_id`/`task_name`.
  const tasks: { task_id?: unknown; task_name?: unknown; type?: unknown }[] = page.data;
  const exact = tasks.filter(
    (task) => typeof task.task_name === "string" && matchesScanTaskMarker(task.task_name, row.id),
  );
  if (exact.length > 1) return { kind: "unreadable" as const };

  // Prefer the provider reference recorded at acceptance; it identifies the task
  // this request created even if the list page no longer includes it.
  let task = row.provider_ref
    ? tasks.find((entry) => asProviderId(entry.task_id) === row.provider_ref)
    : undefined;
  if (!task) task = exact[0];
  if (!task) return { kind: "still_running" as const };

  const taskId = asProviderId(task.task_id) ?? row.provider_ref;
  if (!taskId) return { kind: "unreadable" as const };
  // A guessed task type would read the wrong status endpoint.
  if (typeof task.type !== "number" || !Number.isInteger(task.type)) return { kind: "unreadable" as const };

  // The jobs list carries only `{ id, date, affected_items }`; per-device
  // status lives under `/jobs/{jobId}/status`. No job yet means the task has
  // not been picked up, which is progress-pending, not unreadable.
  const jobs = (await client.listTaskJobs(task.type, taskId)) as unknown;
  const jobList = Array.isArray(jobs)
    ? jobs
    : typeof jobs === "object" && jobs !== null && Array.isArray((jobs as { data?: unknown }).data)
      ? (jobs as { data: unknown[] }).data
      : null;
  if (!jobList) return { kind: "unreadable" as const };
  if (jobList.length === 0) return { kind: "still_running" as const };
  if (jobList.length > 10) return { kind: "unreadable" as const };
  const statuses: unknown[] = [];
  for (const job of jobList) {
    const jobId = asProviderId((job as { id?: unknown } | null)?.id);
    if (!jobId) return { kind: "unreadable" as const };
    let complete = false;
    for (let skip = 0; skip < 1000; skip += 100) {
      const page = await client.getTaskJobStatus(task.type, taskId, jobId, { top: 100, skip });
      statuses.push(...page.data);
      if (page.data.length < 100 || (page.totalItems !== null && skip + page.data.length >= page.totalItems)) {
        complete = true;
        break;
      }
    }
    // A bounded/truncated read must never verify completion.
    if (!complete) return { kind: "unreadable" as const };
  }
  if (statuses.length === 0) return { kind: "still_running" as const };
  const aggregate = aggregateScanJobStatuses(statuses);
  if (aggregate === "unreadable") return { kind: "unreadable" as const };
  if (aggregate === "failed") return { kind: "finished" as const, outcome: "failed" as const, resultsComplete: false };
  if (aggregate === "completed") return { kind: "finished" as const, outcome: "completed" as const, resultsComplete: false };
  return { kind: "still_running" as const };
}

function asProviderId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * ThreatSync status observation. Strictly mapped: only the documented
 * `inProgress`/`performed` action statuses (and an exact incident-status match
 * for `ts_incident_status`) conclude anything; every other value is unreadable
 * and goes to review instead of being guessed into a terminal state.
 */
async function observeThreatSyncAction(
  client: ReturnType<typeof createWatchGuardClient>,
  row: ObserveRow,
) {
  if (row.action_type === "ts_incident_status") {
    if (!row.provider_incident_id) return { kind: "unreadable" as const };
    // The requested target status is the frozen parameter; an incident matches
    // only when the provider reports exactly that status.
    const requested = (row.params ?? null) !== null && typeof row.params === "object"
      && typeof (row.params as { status?: unknown }).status === "string"
      ? (row.params as { status: string }).status
      : null;
    if (!requested) return { kind: "unreadable" as const };
    const incident = await client.getIncident(row.provider_incident_id);
    const decision = interpretIncidentStatusMatch(requested, incident.status ?? null);
    if (decision.kind === "finished") {
      return { kind: "finished" as const, outcome: decision.outcome, resultsComplete: false };
    }
    return decision;
  }

  // Command actions report through the account-level action status read.
  if (!row.provider_ref) return { kind: "unreadable" as const };
  const action = await client.getAction(row.provider_ref);
  const decision = interpretThreatSyncStatus(action.status ?? null);
  if (decision.kind === "finished") {
    return { kind: "finished" as const, outcome: decision.outcome, resultsComplete: false };
  }
  return decision;
}

/**
 * Endpoint state observation for isolation and release. Only an explicitly
 * recognized state counts: an unknown or transitional value is unreadable, not
 * "not isolated".
 */
async function observeEndpointState(
  client: ReturnType<typeof createWatchGuardClient>,
  row: ObserveRow,
) {
  const { rows } = await db.execute<{ device_id: string | null }>(sql`
    SELECT wg_device_id AS device_id FROM epdr_endpoints WHERE id = ${row.endpoint_id} LIMIT 1`);
  const deviceId = rows[0]?.device_id;
  if (!deviceId) return { kind: "unreadable" as const };

  const devices = await client.listDevices({ top: 1000 });
  const match = (devices.data as unknown as { device_id?: string; isolation_state?: unknown }[])
    .find((device) => device.device_id === deviceId);
  if (!match) return { kind: "unreadable" as const };

  if (row.action_type === "isolate" || row.action_type === "unisolate") {
    const state = classifyIsolationState(match.isolation_state);
    if (state === "unknown") return { kind: "unreadable" as const };
    const matches = row.action_type === "isolate" ? state === "isolated" : state === "not_isolated";
    return matches
      ? { kind: "finished" as const, outcome: "completed" as const, resultsComplete: false }
      : { kind: "still_running" as const };
  }

  // Reboot and configuration assignment have no verified completion read here.
  return { kind: "unreadable" as const };
}

/**
 * Close approvals that expired while still waiting. A `pending_approval` or
 * `queued` request past its approval window can never be legitimately sent
 * again, so the sweep cancels it with an explicit reason instead of letting it
 * sit in the queue forever. Nothing here was ever sent.
 */
export async function expireExpiredApprovals(connectionId: number): Promise<number> {
  const { rows } = await db.execute<{ id: number }>(sql`
    UPDATE epdr_actions SET state = 'cancelled', review_reason = 'approval_expired',
      lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE connection_id = ${connectionId} AND mode = 'approval' AND namespace IS NOT NULL
      AND state IN ('pending_approval', 'queued')
      AND approval_expires_at IS NOT NULL AND approval_expires_at <= clock_timestamp()
    RETURNING id`);
  return rows.length;
}

/**
 * Move requests that exhausted their observation budget to `needs_review`.
 * Without this they would silently stop being observed while still claiming
 * `in_progress`.
 */
async function expireExhaustedObservations(connectionId: number): Promise<number> {
  const { rows } = await db.execute<{ id: number }>(sql`
    UPDATE epdr_actions SET state = 'needs_review', review_reason = 'observation_exhausted',
      lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE connection_id = ${connectionId} AND mode = 'approval' AND namespace IS NOT NULL
      AND state IN ('in_progress', 'outcome_unknown')
      AND observe_attempts >= ${OBSERVE_MAX_ATTEMPTS}
    RETURNING id`);
  return rows.length;
}

/**
 * Recover requests whose dispatch lease expired without a published result.
 * They may have been performed, so they become `outcome_unknown`. The matching
 * attempt row stops claiming `sending`, because the outcome is unknown.
 */
export async function recoverStaleDispatchLeases(connectionId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ id: number }>(sql`
      UPDATE epdr_actions a SET state = 'outcome_unknown', outcome_unknown_reason = 'lease_expired_after_send',
        lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
      FROM watchguard_connections c
      WHERE c.id = ${connectionId} AND a.connection_id = c.id AND a.site_id = c.site_id
        AND a.mode = 'approval' AND a.state = 'dispatching'
        AND a.lease_expires_at IS NOT NULL AND a.lease_expires_at <= clock_timestamp()
      RETURNING a.id`);
    if (rows.length > 0) {
      const ids = sql.raw(`ARRAY[${rows.map((row) => row.id).join(",")}]`);
      await tx.execute(sql`
        UPDATE epdr_attempts SET status = 'ambiguous', error = 'lease_expired_after_send'
        WHERE action_id = ANY(${ids}) AND phase = 'dispatch' AND status = 'sending'`);
    }
    return rows.length;
  });
}

export type { WriteActionType };
