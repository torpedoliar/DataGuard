/**
 * Immutable execution snapshot + canonical parameter validation.
 *
 * Pure. No DB, no network, no credentials. The snapshot is the exact state an
 * administrator approves and the dispatcher re-checks: any material difference
 * (target, parameters, revisions) produces a different hash, so an approval
 * that described a different request can never be reused.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  getWriteOperation,
  THREATSYNC_COMMANDS,
  type ExecutionNamespace,
  type WriteActionType,
  type WriteOperation,
} from "./execution-capability";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ExecutionParameters = Record<string, JsonValue>;

export type ExecutionTarget = {
  /** Internal endpoint row; every request is bound to exactly one endpoint. */
  endpointId: number;
  /** Endpoint Security device id. Null for ThreatSync-only targets. */
  deviceId: string | null;
  /** ThreatSync entity id. Null for Endpoint Security targets. */
  entityId: string | null;
  /** Provider incident id for incident-scoped operations. */
  providerIncidentId: string | null;
};

export type ExecutionSnapshot = {
  siteId: number;
  connectionId: number;
  region: string;
  accountId: string;
  target: ExecutionTarget;
  namespace: ExecutionNamespace;
  actionType: WriteActionType;
  parameters: ExecutionParameters;
  accountRevision: number;
  credentialRevision: number;
  /** Evidence generation at request time; a newer generation invalidates approval. */
  evidenceGeneration: number;
  requesterId: number;
  /** Epoch milliseconds. */
  expiresAt: number;
};

export type ParameterValidation =
  | { ok: true; parameters: ExecutionParameters }
  | { ok: false; reason: string };

const MD5 = /^[0-9a-f]{32}$/i;
const PID = /^[1-9][0-9]{0,9}$/;
const CONFIG_ID = /^[A-Za-z0-9._~-]{1,64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAddress(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return isIP(trimmed) !== 0;
  const base = trimmed.slice(0, slash);
  const prefix = trimmed.slice(slash + 1);
  const version = isIP(base);
  if (version === 0 || !/^[0-9]{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return version === 4 ? bits >= 0 && bits <= 32 : bits >= 0 && bits <= 128;
}

/**
 * Validate and normalize the operation's parameters. Unknown keys, wrong
 * types, out-of-range values, and missing required values are rejected — the
 * provider never receives a free-form payload.
 */
export function validateExecutionParameters(
  operation: WriteOperation,
  raw: unknown,
): ParameterValidation {
  if (raw === undefined || raw === null) return validateParsed(operation, {});
  if (!isPlainObject(raw)) return { ok: false, reason: "parameters_not_an_object" };
  for (const key of Object.keys(raw)) {
    if (!operation.allowedParams.includes(key)) return { ok: false, reason: `parameter_not_allowed:${key}` };
  }
  return validateParsed(operation, raw);
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d{1,9}$/.test(value.trim())) return Number(value.trim());
  return null;
}

function validateParsed(operation: WriteOperation, raw: Record<string, unknown>): ParameterValidation {
  const out: ExecutionParameters = {};
  const action = operation.actionType;

  for (const required of operation.requiredParams) {
    if (raw[required] === undefined || raw[required] === null) {
      const ok = action === "ts_kill_process" && (raw.pid !== undefined || raw.md5 !== undefined);
      if (!ok) return { ok: false, reason: `missing_parameter:${required}` };
    }
  }

  if (action === "scan") {
    if (raw.scan_scope !== undefined) {
      const scope = toInteger(raw.scan_scope);
      // Scope 2 selects specific items, which requires item parameters this
      // release does not implement. Offering it would send an incomplete body.
      if (scope === null || scope < 0 || scope > 1) return { ok: false, reason: "invalid_scan_scope" };
      out.scan_scope = scope;
    }
  }

  if (action === "reboot") {
    const type = toInteger(raw.count_down_type);
    if (type === null || type < 1 || type > 7) return { ok: false, reason: "invalid_count_down_type" };
    out.count_down_type = type;
  }

  if (action === "assign_config") {
    if (typeof raw.config_id !== "string" || !CONFIG_ID.test(raw.config_id)) {
      return { ok: false, reason: "invalid_config_id" };
    }
    out.config_id = raw.config_id;
  }

  if (action === "ts_kill_process") {
    const hasPid = raw.pid !== undefined && raw.pid !== null;
    const hasMd5 = raw.md5 !== undefined && raw.md5 !== null;
    if (hasPid === hasMd5) return { ok: false, reason: "kill_process_requires_pid_xor_md5" };
    if (hasPid) {
      const pid = String(raw.pid).trim();
      if (!PID.test(pid)) return { ok: false, reason: "invalid_pid" };
      out.pid = pid;
    } else {
      const md5 = String(raw.md5).trim();
      if (!MD5.test(md5)) return { ok: false, reason: "invalid_md5" };
      out.md5 = md5.toLowerCase();
    }
  }

  if (action === "ts_quarantine") {
    const md5 = String(raw.md5 ?? "").trim();
    if (!MD5.test(md5)) return { ok: false, reason: "invalid_md5" };
    out.md5 = md5.toLowerCase();
  }

  if (action === "ts_block_ip" || action === "ts_unblock_ip") {
    const address = String(raw.address ?? "").trim();
    if (!validateAddress(address)) return { ok: false, reason: "invalid_address" };
    out.address = address;
  }

  if (action === "ts_incident_status") {
    const status = String(raw.status ?? "").trim();
    if (!["new", "read", "closed"].includes(status)) return { ok: false, reason: "invalid_incident_status" };
    out.status = status;
    if (raw.comment !== undefined && raw.comment !== null) {
      if (typeof raw.comment !== "string") return { ok: false, reason: "invalid_comment" };
      const comment = raw.comment.trim();
      if (comment.length < 1 || comment.length > 1000) return { ok: false, reason: "invalid_comment" };
      out.comment = comment;
    }
  }

  return { ok: true, parameters: out };
}

/** Deterministic JSON: object keys sorted, arrays keep order. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable identity of an approved request. Any material change yields a new hash. */
export function executionSnapshotHash(snapshot: ExecutionSnapshot): string {
  const canonical: JsonValue = {
    siteId: snapshot.siteId,
    connectionId: snapshot.connectionId,
    region: snapshot.region,
    accountId: snapshot.accountId,
    target: {
      endpointId: snapshot.target.endpointId,
      deviceId: snapshot.target.deviceId,
      entityId: snapshot.target.entityId,
      providerIncidentId: snapshot.target.providerIncidentId,
    },
    namespace: snapshot.namespace,
    actionType: snapshot.actionType,
    parameters: snapshot.parameters,
    accountRevision: snapshot.accountRevision,
    credentialRevision: snapshot.credentialRevision,
    evidenceGeneration: snapshot.evidenceGeneration,
    requesterId: snapshot.requesterId,
    expiresAt: snapshot.expiresAt,
  };
  return createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
}

/** Identity of the actionable intent, independent of requester and expiry. */
export function executionIntentKey(snapshot: ExecutionSnapshot): string {
  const canonical: JsonValue = {
    siteId: snapshot.siteId,
    endpointId: snapshot.target.endpointId,
    namespace: snapshot.namespace,
    actionType: snapshot.actionType,
    parameters: snapshot.parameters,
    accountRevision: snapshot.accountRevision,
  };
  return createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
}

export type SnapshotValidation =
  | { ok: true; snapshot: ExecutionSnapshot }
  | { ok: false; reason: string };

/**
 * Structural validation of a stored/derived snapshot. Rejects a target that
 * does not match the operation's namespace (a ThreatSync command must carry an
 * entity id; an Endpoint Security command must carry a device id).
 */
export function validateExecutionSnapshot(input: unknown): SnapshotValidation {
  if (!isPlainObject(input)) return { ok: false, reason: "snapshot_not_an_object" };
  const namespace = input.namespace;
  const actionType = input.actionType;
  if (namespace !== "endpoint_security" && namespace !== "threatsync") return { ok: false, reason: "invalid_namespace" };
  const operation = getWriteOperation(namespace, String(actionType));
  if (!operation) return { ok: false, reason: "operation_not_verified" };

  const target = input.target;
  if (!isPlainObject(target)) return { ok: false, reason: "invalid_target" };
  const endpointId = Number(target.endpointId);
  if (!Number.isSafeInteger(endpointId) || endpointId < 1) return { ok: false, reason: "invalid_endpoint" };
  const deviceId = target.deviceId === null || target.deviceId === undefined ? null : String(target.deviceId);
  const entityId = target.entityId === null || target.entityId === undefined ? null : String(target.entityId);
  const providerIncidentId = target.providerIncidentId === null || target.providerIncidentId === undefined
    ? null : String(target.providerIncidentId);

  if (operation.namespace === "endpoint_security" && !deviceId) return { ok: false, reason: "missing_device_id" };
  if (operation.namespace === "threatsync" && operation.path === "/actions" && !entityId) {
    return { ok: false, reason: "missing_entity_id" };
  }
  if (operation.path.includes("{providerIncidentId}") && !providerIncidentId) {
    return { ok: false, reason: "missing_provider_incident" };
  }

  const params = validateExecutionParameters(operation, input.parameters);
  if (!params.ok) return { ok: false, reason: params.reason };

  const numbers: { key: keyof ExecutionSnapshot; min: number }[] = [
    { key: "siteId", min: 1 },
    { key: "connectionId", min: 1 },
    { key: "accountRevision", min: 0 },
    { key: "credentialRevision", min: 0 },
    { key: "evidenceGeneration", min: 0 },
    { key: "requesterId", min: 1 },
    { key: "expiresAt", min: 1 },
  ];
  for (const { key, min } of numbers) {
    const value = Number(input[key as string]);
    if (!Number.isSafeInteger(value) || value < min) return { ok: false, reason: `invalid_${String(key)}` };
  }
  if (typeof input.region !== "string" || input.region.length === 0) return { ok: false, reason: "invalid_region" };
  if (typeof input.accountId !== "string" || input.accountId.length === 0) return { ok: false, reason: "invalid_account" };

  return {
    ok: true,
    snapshot: {
      siteId: Number(input.siteId),
      connectionId: Number(input.connectionId),
      region: input.region,
      accountId: input.accountId,
      target: { endpointId, deviceId, entityId, providerIncidentId },
      namespace: operation.namespace,
      actionType: operation.actionType,
      parameters: params.parameters,
      accountRevision: Number(input.accountRevision),
      credentialRevision: Number(input.credentialRevision),
      evidenceGeneration: Number(input.evidenceGeneration),
      requesterId: Number(input.requesterId),
      expiresAt: Number(input.expiresAt),
    },
  };
}

/** ThreatSync command name for an action, or null when it is not a command. */
export function threatSyncCommandFor(actionType: WriteActionType): string | null {
  return THREATSYNC_COMMANDS[actionType] ?? null;
}
