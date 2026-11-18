/**
 * Provider request-body construction.
 *
 * Pure. Bodies are derived from the verified operation, the frozen snapshot,
 * and server-side identity — never from a free-form client payload. Only fields
 * whose names are stated in the published documentation are emitted; anything
 * not re-verified is omitted rather than guessed.
 */
import type { WriteOperation } from "./execution-capability";
import { THREATSYNC_COMMANDS } from "./execution-capability";
import { buildScanTaskName } from "./execution-dispatch";
import type { ExecutionSnapshot } from "./execution-request";

export type WriteBodyContext = {
  /** Internal request id; used for the scan correlation marker. */
  requestId: number;
  /** Endpoint hostname for a readable task name. Null is allowed. */
  hostName: string | null;
};

export type WriteBodyResult =
  | { ok: true; body: Record<string, unknown>; pathParams: Record<string, string> }
  | { ok: false; reason: string };

const THREATSYNC_PARAMETER_KEYS = ["pid", "md5", "address"] as const;

function deviceIds(snapshot: ExecutionSnapshot): string[] {
  const deviceId = snapshot.target.deviceId;
  return deviceId ? [deviceId] : [];
}

export function buildWriteBody(
  operation: WriteOperation,
  snapshot: ExecutionSnapshot,
  context: WriteBodyContext,
): WriteBodyResult {
  const params = snapshot.parameters;

  if (operation.namespace === "endpoint_security") {
    const ids = deviceIds(snapshot);
    // Exactly one target per request; a request never fans out.
    if (ids.length !== 1) return { ok: false, reason: "invalid_target" };

    switch (operation.actionType) {
      case "scan": {
        const body: Record<string, unknown> = {
          device_ids: ids,
          task_name: buildScanTaskName(context.requestId, context.hostName),
        };
        if (params.scan_scope !== undefined) body.scan_scope = params.scan_scope;
        return { ok: true, body, pathParams: {} };
      }
      case "isolate":
      case "unisolate":
        return { ok: true, body: { device_ids: ids }, pathParams: {} };
      case "reboot": {
        const countDown = params.count_down_type;
        if (countDown === undefined) return { ok: false, reason: "missing_count_down_type" };
        return {
          ok: true,
          body: { device_ids: ids, action_type: 1, count_down_type: countDown },
          pathParams: {},
        };
      }
      case "assign_config": {
        const configId = params.config_id;
        if (typeof configId !== "string") return { ok: false, reason: "missing_config_id" };
        return { ok: true, body: { device_ids: ids }, pathParams: { configId } };
      }
      default:
        return { ok: false, reason: "operation_not_verified" };
    }
  }

  // ThreatSync
  if (operation.actionType === "ts_incident_status") {
    const providerIncidentId = snapshot.target.providerIncidentId;
    if (!providerIncidentId) return { ok: false, reason: "missing_provider_incident" };
    const body: Record<string, unknown> = { status: params.status };
    if (typeof params.comment === "string") body.comment = params.comment;
    return { ok: true, body, pathParams: { providerIncidentId } };
  }

  const command = THREATSYNC_COMMANDS[operation.actionType];
  if (!command) return { ok: false, reason: "operation_not_verified" };
  const entityId = snapshot.target.entityId;
  // A ThreatSync entity id is required and is never derived from a device id.
  if (!entityId) return { ok: false, reason: "missing_entity_id" };
  if (entityId === snapshot.target.deviceId) return { ok: false, reason: "entity_id_collides_with_device_id" };

  const parameters: Record<string, unknown> = {};
  for (const key of THREATSYNC_PARAMETER_KEYS) {
    const value = params[key];
    if (value !== undefined) parameters[key] = value;
  }
  return { ok: true, body: { command, entityId, parameters }, pathParams: {} };
}

/** Serialize the body deterministically; the exact bytes are hashed for audit. */
export function serializeWriteBody(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}
