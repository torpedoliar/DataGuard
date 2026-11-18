/**
 * Fail-closed execution eligibility.
 *
 * Pure. No DB, no network, no credentials. Every check is evaluated from
 * trusted state that the caller rebuilds from the database at the moment of
 * the decision; nothing here trusts a client-supplied flag, a stored
 * "approved" boolean on its own, or a previous decision.
 *
 * The three stages are deliberately separate:
 * - `request`: may this operator ask for this operation on this target now?
 * - `approve`: may this second administrator authorize the frozen snapshot?
 * - `dispatch`: may the worker send it right now, with the same snapshot?
 */
import {
  executionSnapshotHash,
  validateExecutionSnapshot,
  type ExecutionSnapshot,
} from "./execution-request";
import { getWriteOperation, type ExecutionNamespace } from "./execution-capability";

export type ExecutionStage = "request" | "approve" | "dispatch";

export type ExecutionBlockReason =
  | "write_not_enabled"
  | "global_kill_switch"
  | "site_kill_switch"
  | "automation_paused"
  | "action_not_allowed"
  | "connection_disabled"
  | "write_credentials_missing"
  | "operation_not_verified"
  | "snapshot_invalid"
  | "snapshot_changed"
  | "approval_missing"
  | "approval_expired"
  | "self_approval"
  | "approver_not_admin"
  | "requester_not_authorized"
  | "endpoint_missing"
  | "endpoint_removed"
  | "endpoint_hold"
  | "exclusion_active"
  | "data_stale"
  | "cooldown_active"
  | "rate_limited"
  | "target_incident_ambiguous"
  | "already_terminal";

export type ExecutionDecision =
  | { allowed: true; snapshotHash: string }
  | { allowed: false; reason: ExecutionBlockReason };

export type ExecutionPolicyInput = {
  stage: ExecutionStage;
  nowMs: number;

  /** Deployment/site/action enablement. Every flag defaults to off. */
  writeEnabled: boolean;
  globalKillSwitch: boolean;
  siteKillSwitch: boolean;
  /** Site-level automation pause stops new sends, including approved ones. */
  automationPaused: boolean;
  /** Ceiling from global settings. */
  allowedActions: readonly string[];
  /** Per-site narrowing of the global ceiling. */
  siteAllowedActions: readonly string[];

  connectionEnabled: boolean;
  writeCredentialsPresent: boolean;

  /** Current binding revisions; the snapshot must match exactly. */
  currentAccountRevision: number;
  currentCredentialRevision: number;
  /** Current evidence generation; a newer generation invalidates the snapshot. */
  currentEvidenceGeneration: number;

  endpointPresent: boolean;
  endpointRemoved: boolean;
  endpointHold: boolean;
  exclusionActive: boolean;
  dataFresh: boolean;

  /** Recent provider writes for the same endpoint and action inside cooldown. */
  cooldownActive: boolean;
  /** Provider writes in the last hour across the site. */
  actionsLastHour: number;
  maxActionsPerHour: number;

  /** The frozen snapshot being evaluated. */
  snapshot: unknown;
  /** Re-derived snapshot from current trusted state; required for `dispatch`. */
  currentSnapshot?: unknown;

  /** Approval facts; required from `dispatch` onward. */
  approval?: { approverId: number; approverIsCurrentSiteAdmin: boolean; expiresAt: number } | null;
  requesterId: number;
  requesterIsCurrentlyAuthorized: boolean;

  /** Current terminal state of the request, when re-evaluating. */
  terminal?: boolean;
};

function matchesNamespace(snapshot: ExecutionSnapshot, namespace: ExecutionNamespace): boolean {
  return snapshot.namespace === namespace;
}

/**
 * Evaluate one stage. Returns the first blocking reason in a fixed order so the
 * UI and the audit record always explain the same dominant cause.
 */
export function evaluateExecutionPolicy(input: ExecutionPolicyInput): ExecutionDecision {
  const parsed = validateExecutionSnapshot(input.snapshot);
  if (!parsed.ok) return { allowed: false, reason: "snapshot_invalid" };
  const snapshot = parsed.snapshot;
  const hash = executionSnapshotHash(snapshot);

  const operation = getWriteOperation(snapshot.namespace, snapshot.actionType);
  if (!operation) return { allowed: false, reason: "operation_not_verified" };
  if (!matchesNamespace(snapshot, operation.namespace)) return { allowed: false, reason: "operation_not_verified" };

  if (!input.writeEnabled) return { allowed: false, reason: "write_not_enabled" };
  if (input.globalKillSwitch) return { allowed: false, reason: "global_kill_switch" };
  if (input.siteKillSwitch) return { allowed: false, reason: "site_kill_switch" };
  if (input.automationPaused) return { allowed: false, reason: "automation_paused" };
  if (!input.allowedActions.includes(snapshot.actionType)) return { allowed: false, reason: "action_not_allowed" };
  if (!input.siteAllowedActions.includes(snapshot.actionType)) return { allowed: false, reason: "action_not_allowed" };
  if (!input.connectionEnabled) return { allowed: false, reason: "connection_disabled" };

  // Reads may fall back to RW credentials; a write may never fall back to RO.
  if (!input.writeCredentialsPresent) return { allowed: false, reason: "write_credentials_missing" };

  if (snapshot.accountRevision !== input.currentAccountRevision) return { allowed: false, reason: "snapshot_changed" };
  if (snapshot.credentialRevision !== input.currentCredentialRevision) return { allowed: false, reason: "snapshot_changed" };
  if (snapshot.evidenceGeneration !== input.currentEvidenceGeneration) return { allowed: false, reason: "snapshot_changed" };

  // Both approval and dispatch must prove the frozen snapshot still describes
  // current state. `approve` used to skip this, which let a re-bound device be
  // approved against a stale target.
  if (input.stage !== "request") {
    if (!input.currentSnapshot) return { allowed: false, reason: "snapshot_changed" };
    const current = validateExecutionSnapshot(input.currentSnapshot);
    if (!current.ok) return { allowed: false, reason: "snapshot_changed" };
    if (executionSnapshotHash(current.snapshot) !== hash) return { allowed: false, reason: "snapshot_changed" };
  }

  if (!input.endpointPresent) return { allowed: false, reason: "endpoint_missing" };
  if (input.endpointRemoved) return { allowed: false, reason: "endpoint_removed" };
  if (input.endpointHold) return { allowed: false, reason: "endpoint_hold" };
  if (input.exclusionActive) return { allowed: false, reason: "exclusion_active" };
  if (!input.dataFresh) return { allowed: false, reason: "data_stale" };

  if (input.cooldownActive) return { allowed: false, reason: "cooldown_active" };
  if (input.actionsLastHour >= input.maxActionsPerHour) return { allowed: false, reason: "rate_limited" };

  if (!input.requesterIsCurrentlyAuthorized) return { allowed: false, reason: "requester_not_authorized" };

  if (input.stage === "approve") {
    const approval = input.approval;
    if (!approval) return { allowed: false, reason: "approval_missing" };
    if (approval.approverId === snapshot.requesterId) return { allowed: false, reason: "self_approval" };
    // The approving administrator must still be an active site administrator.
    if (!approval.approverIsCurrentSiteAdmin) return { allowed: false, reason: "approver_not_admin" };
    // A request whose own window lapsed can no longer be approved.
    if (approval.expiresAt <= input.nowMs) return { allowed: false, reason: "approval_expired" };
    if (snapshot.expiresAt <= input.nowMs) return { allowed: false, reason: "approval_expired" };
  }

  if (input.stage === "dispatch") {
    if (input.terminal) return { allowed: false, reason: "already_terminal" };
    const approval = input.approval;
    if (!approval) return { allowed: false, reason: "approval_missing" };
    if (approval.approverId === snapshot.requesterId) return { allowed: false, reason: "self_approval" };
    if (!approval.approverIsCurrentSiteAdmin) return { allowed: false, reason: "approver_not_admin" };
    // An approval that already lapsed cannot authorize a send.
    if (approval.expiresAt <= input.nowMs) return { allowed: false, reason: "approval_expired" };
    // The snapshot's own expiry bounds the window in which a send is meaningful.
    if (snapshot.expiresAt <= input.nowMs) return { allowed: false, reason: "approval_expired" };
  }

  return { allowed: true, snapshotHash: hash };
}

/** Human-facing reason ordering for audit/UI grouping. */
export function isHardBlock(reason: ExecutionBlockReason): boolean {
  return (
    reason === "write_not_enabled" ||
    reason === "operation_not_verified" ||
    reason === "snapshot_invalid" ||
    reason === "approver_not_admin" ||
    reason === "self_approval"
  );
}
