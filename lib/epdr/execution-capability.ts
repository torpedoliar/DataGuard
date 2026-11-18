/**
 * Verified WatchGuard write-operation registry.
 *
 * Single source of truth for what the application may ask a provider to do.
 * Every entry here is backed by RW_CAPABILITY_MATRIX.md, which records the
 * public documentation it was verified against. Adding a value to
 * EPDR_ACTION_TYPES does not enable it; an operation is dispatchable only when
 * it appears in {@link WRITE_OPERATIONS}.
 *
 * Pure data + lookups. No DB, no network, no credentials.
 */
import type { EpdrActionType } from "./action-types";

export type ExecutionNamespace = "endpoint_security" | "threatsync";

/** Verified write commands. Excluded operations are documented, not implicit. */
export const WRITE_ACTION_TYPES = [
  "scan",
  "isolate",
  "unisolate",
  "reboot",
  "assign_config",
  "ts_isolate",
  "ts_unisolate",
  "ts_kill_process",
  "ts_quarantine",
  "ts_block_ip",
  "ts_unblock_ip",
  "ts_incident_status",
] as const;

export type WriteActionType = (typeof WRITE_ACTION_TYPES)[number];

/**
 * How the provider reports the outcome of a write.
 * - `task_id`: a scan task id that needs separate polling.
 * - `processed_device_ids`: an acceptance list for the listed devices.
 * - `action_ref`: a ThreatSync action id readable through the actions API.
 * - `status`: the mutation itself returns the new state.
 */
export type ProviderReceipt = "task_id" | "processed_device_ids" | "action_ref" | "status";

export type WriteOperation = {
  namespace: ExecutionNamespace;
  actionType: WriteActionType;
  /** Exact HTTP method. Never inferred at call time. */
  method: "POST" | "PATCH";
  /** Path relative to the namespace service prefix; `{...}` are validated segments. */
  path: string;
  receipt: ProviderReceipt;
  /** Parameters that must be present and valid. */
  requiredParams: readonly string[];
  /** The only parameters accepted; anything else is rejected before dispatch. */
  allowedParams: readonly string[];
  /** Changes endpoint isolation/continuity state; not necessarily reversible. */
  highImpact: boolean;
  /**
   * `automatic` when this release can read completion from the provider.
   * `manual_review` when it can confirm acceptance only; completion is never
   * inferred and the request ends in `needs_review`.
   */
  observationSupport: "automatic" | "manual_review";
};

const ENDPOINT_PREFIX = "";

/**
 * Endpoint Security operations. Device identifiers are Endpoint Security
 * device IDs, never ThreatSync entity IDs.
 */
const ENDPOINT_SECURITY_OPERATIONS: readonly WriteOperation[] = [
  {
    namespace: "endpoint_security",
    actionType: "scan",
    method: "POST",
    path: `${ENDPOINT_PREFIX}/immediatescan`,
    receipt: "task_id",
    requiredParams: [],
    // Execution-window and detection-option field names were not re-verified,
    // so this release sends only the fields the documentation states explicitly.
    allowedParams: ["scan_scope"],
    highImpact: false,
    observationSupport: "automatic",
  },
  {
    namespace: "endpoint_security",
    actionType: "isolate",
    method: "POST",
    path: `${ENDPOINT_PREFIX}/devices/isolation`,
    receipt: "processed_device_ids",
    requiredParams: [],
    allowedParams: [],
    highImpact: true,
    observationSupport: "automatic",
  },
  {
    namespace: "endpoint_security",
    actionType: "unisolate",
    method: "POST",
    path: `${ENDPOINT_PREFIX}/devices/noisolation`,
    receipt: "processed_device_ids",
    requiredParams: [],
    allowedParams: [],
    highImpact: true,
    observationSupport: "automatic",
  },
  {
    namespace: "endpoint_security",
    actionType: "reboot",
    method: "POST",
    path: `${ENDPOINT_PREFIX}/devices/action`,
    receipt: "processed_device_ids",
    requiredParams: ["count_down_type"],
    allowedParams: ["count_down_type"],
    highImpact: true,
    observationSupport: "manual_review",
  },
  {
    namespace: "endpoint_security",
    actionType: "assign_config",
    method: "PATCH",
    path: `${ENDPOINT_PREFIX}/managedconfigurations/2/{configId}`,
    receipt: "status",
    requiredParams: ["config_id"],
    allowedParams: ["config_id"],
    highImpact: true,
    observationSupport: "manual_review",
  },
];

/**
 * ThreatSync operations. `entityId` is the ThreatSync entity, never an
 * Endpoint Security device ID. Account-level action endpoint is used because
 * `comment` is not documented for it, and this release never sends comments.
 */
const THREATSYNC_COMMAND: readonly WriteOperation[] = [
  { namespace: "threatsync", actionType: "ts_isolate", method: "POST", path: "/actions", receipt: "action_ref", requiredParams: [], allowedParams: [], highImpact: true, observationSupport: "manual_review" },
  { namespace: "threatsync", actionType: "ts_unisolate", method: "POST", path: "/actions", receipt: "action_ref", requiredParams: [], allowedParams: [], highImpact: true, observationSupport: "manual_review" },
  { namespace: "threatsync", actionType: "ts_kill_process", method: "POST", path: "/actions", receipt: "action_ref", requiredParams: [], allowedParams: ["pid", "md5"], highImpact: true, observationSupport: "manual_review" },
  { namespace: "threatsync", actionType: "ts_quarantine", method: "POST", path: "/actions", receipt: "action_ref", requiredParams: ["md5"], allowedParams: ["md5"], highImpact: true, observationSupport: "manual_review" },
  { namespace: "threatsync", actionType: "ts_block_ip", method: "POST", path: "/actions", receipt: "action_ref", requiredParams: ["address"], allowedParams: ["address"], highImpact: false, observationSupport: "manual_review" },
  { namespace: "threatsync", actionType: "ts_unblock_ip", method: "POST", path: "/actions", receipt: "action_ref", requiredParams: ["address"], allowedParams: ["address"], highImpact: false, observationSupport: "manual_review" },
];

/** Provider incident status changes; verified PATCH contract. */
const THREATSYNC_INCIDENT_STATUS: WriteOperation = {
  namespace: "threatsync",
  actionType: "ts_incident_status",
  method: "PATCH",
  path: "/incidents/{providerIncidentId}",
  receipt: "status",
  requiredParams: ["status"],
  allowedParams: ["status", "comment"],
  highImpact: false,
  observationSupport: "manual_review",
};

export const WRITE_OPERATIONS: readonly WriteOperation[] = [
  ...ENDPOINT_SECURITY_OPERATIONS,
  ...THREATSYNC_COMMAND,
  THREATSYNC_INCIDENT_STATUS,
];

/** ThreatSync command name per action type. */
export const THREATSYNC_COMMANDS: Readonly<Partial<Record<WriteActionType, string>>> = {
  ts_isolate: "isolate",
  ts_unisolate: "unIsolate",
  ts_kill_process: "killProcess",
  ts_quarantine: "quarantineFile",
  ts_block_ip: "blockAddress",
  ts_unblock_ip: "unblockAddress",
};

/** Operations the provider documents but this application refuses to expose. */
export const EXCLUDED_OPERATIONS: readonly { action: string; reason: string }[] = [
  { action: "uninstall_protection", reason: "Removes endpoint protection and has no in-app recovery path." },
  { action: "transact", reason: "Batch contract is documented inconsistently with no atomicity guarantee." },
  { action: "provider_comment", reason: "No documented standalone create operation." },
  { action: "repair", reason: "No documented provider contract." },
];

export function getWriteOperation(
  namespace: ExecutionNamespace,
  actionType: string,
): WriteOperation | null {
  return WRITE_OPERATIONS.find((op) => op.namespace === namespace && op.actionType === actionType) ?? null;
}

export function isWriteActionType(value: unknown): value is WriteActionType {
  return typeof value === "string" && (WRITE_ACTION_TYPES as readonly string[]).includes(value);
}

const REVERSIBLE_ACTIONS = new Set<WriteActionType>(["isolate", "ts_isolate"]);

/** Canonical provider capability label used by UI and audit records. */
export function describeWriteAction(actionType: WriteActionType): {
  namespace: ExecutionNamespace;
  highImpact: boolean;
  reversible: "separate_request" | "not_reversible";
  observationSupport: "automatic" | "manual_review";
} {
  const operation = WRITE_OPERATIONS.find((op) => op.actionType === actionType);
  if (!operation) {
    return {
      namespace: "endpoint_security",
      highImpact: true,
      reversible: "not_reversible",
      observationSupport: "manual_review",
    };
  }
  return {
    namespace: operation.namespace,
    highImpact: operation.highImpact,
    // Only isolation has a documented inverse command. Reboot, process kill,
    // quarantine and incident closure have no in-app undo.
    reversible: REVERSIBLE_ACTIONS.has(operation.actionType) ? "separate_request" : "not_reversible",
    observationSupport: operation.observationSupport,
  };
}

/**
 * Actions that never reach a provider through this application, including
 * values that exist in the wider action-type union for historical reasons.
 */
export function unsupportedActionReason(actionType: string): string | null {
  if (isWriteActionType(actionType)) return null;
  const excluded = EXCLUDED_OPERATIONS.find((entry) => entry.action === actionType);
  return excluded ? excluded.reason : "No verified provider contract for this action.";
}

export type { EpdrActionType };
