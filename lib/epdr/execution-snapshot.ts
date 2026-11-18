/**
 * Shared construction of the exact execution snapshot.
 *
 * Both request creation and every later re-evaluation (approval, worker
 * dispatch) must derive the snapshot the same way from current trusted state.
 * Keeping one builder prevents the "approved one thing, sent another" class of
 * bug that arises when each caller rebuilds it slightly differently.
 */
import { getWriteOperation } from "./execution-capability";
import {
  validateExecutionParameters,
  validateExecutionSnapshot,
  type ExecutionSnapshot,
} from "./execution-request";
import {
  loadConnectionBinding,
  loadEndpointExecutionState,
} from "./execution-store";

export type SnapshotBuildReason =
  | "connection_unavailable"
  | "action_not_allowed"
  | "invalid_input"
  | "endpoint_unavailable"
  | "target_unresolved"
  | "target_ambiguous";

export type SnapshotBuildResult =
  | { ok: true; snapshot: ExecutionSnapshot }
  | { ok: false; reason: SnapshotBuildReason; detail?: string };

export async function buildExecutionSnapshot(input: {
  siteId: number;
  endpointId: number;
  actionType: string;
  parameters: Record<string, unknown>;
  requesterId: number;
  expiresAt: number;
}): Promise<SnapshotBuildResult> {
  const binding = await loadConnectionBinding(input.siteId);
  if (!binding || !binding.enabled) return { ok: false, reason: "connection_unavailable" };
  if (!binding.region || !binding.accountId) return { ok: false, reason: "connection_unavailable" };

  const namespace = input.actionType.startsWith("ts_") ? "threatsync" : "endpoint_security";
  const operation = getWriteOperation(namespace, input.actionType);
  if (!operation) return { ok: false, reason: "action_not_allowed" };

  const params = validateExecutionParameters(operation, input.parameters);
  if (!params.ok) return { ok: false, reason: "invalid_input", detail: params.reason };

  const state = await loadEndpointExecutionState(input.siteId, binding.connectionId, input.endpointId);
  if (!state.endpointPresent || state.endpointRemoved) {
    return { ok: false, reason: "endpoint_unavailable" };
  }

  const target = {
    endpointId: input.endpointId,
    deviceId: namespace === "endpoint_security" ? state.deviceId : null,
    entityId: namespace === "threatsync" && operation.path === "/actions" ? state.entityId : null,
    providerIncidentId: operation.path.includes("{providerIncidentId}") ? state.providerIncidentId : null,
  };

  if (namespace === "endpoint_security" && !target.deviceId) {
    return { ok: false, reason: "target_unresolved", detail: "missing_device_id" };
  }
  if (namespace === "threatsync" && operation.path === "/actions" && !target.entityId) {
    return {
      ok: false,
      reason: state.providerIncidentAmbiguous ? "target_ambiguous" : "target_unresolved",
      detail: "entity_id",
    };
  }
  if (operation.path.includes("{providerIncidentId}") && !target.providerIncidentId) {
    return {
      ok: false,
      reason: state.providerIncidentAmbiguous ? "target_ambiguous" : "target_unresolved",
      detail: "provider_incident",
    };
  }

  const snapshot: ExecutionSnapshot = {
    siteId: input.siteId,
    connectionId: binding.connectionId,
    region: binding.region,
    accountId: binding.accountId,
    target,
    namespace: operation.namespace,
    actionType: operation.actionType,
    parameters: params.parameters,
    accountRevision: binding.accountRevision,
    credentialRevision: binding.credentialRevision,
    evidenceGeneration: state.evidenceGeneration,
    requesterId: input.requesterId,
    expiresAt: input.expiresAt,
  };
  const validated = validateExecutionSnapshot(snapshot);
  if (!validated.ok) return { ok: false, reason: "invalid_input", detail: validated.reason };
  return { ok: true, snapshot: validated.snapshot };
}
