import { describe, expect, it } from "vitest";
import { getWriteOperation } from "./execution-capability";
import {
  canonicalJson,
  executionIntentKey,
  executionSnapshotHash,
  validateExecutionParameters,
  validateExecutionSnapshot,
  type ExecutionParameters,
  type ExecutionSnapshot,
} from "./execution-request";

function operation(actionType: string, namespace: "endpoint_security" | "threatsync") {
  const op = getWriteOperation(namespace, actionType);
  if (!op) throw new Error(`missing operation ${namespace}/${actionType}`);
  return op;
}

function baseSnapshot(overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return {
    siteId: 1,
    connectionId: 2,
    region: "jpn",
    accountId: "acct",
    target: { endpointId: 10, deviceId: "dev-1", entityId: null, providerIncidentId: null },
    namespace: "endpoint_security",
    actionType: "scan",
    parameters: {},
    accountRevision: 3,
    credentialRevision: 4,
    evidenceGeneration: 5,
    requesterId: 7,
    expiresAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe("execution parameter validation", () => {
  it("rejects unknown keys rather than forwarding them to the provider", () => {
    const result = validateExecutionParameters(operation("scan", "endpoint_security"), { url: "https://evil.example" });
    expect(result).toEqual({ ok: false, reason: "parameter_not_allowed:url" });
  });

  it("bounds the scan scope and rejects unverified option fields", () => {
    const op = operation("scan", "endpoint_security");
    expect(validateExecutionParameters(op, { scan_scope: 3 })).toEqual({ ok: false, reason: "invalid_scan_scope" });
    expect(validateExecutionParameters(op, { window_hours: 24 })).toEqual({
      ok: false,
      reason: "parameter_not_allowed:window_hours",
    });
    // Scope 2 selects specific items and needs item parameters this release
    // does not implement, so it must not be requestable.
    expect(validateExecutionParameters(op, { scan_scope: 2 })).toEqual({ ok: false, reason: "invalid_scan_scope" });
    expect(validateExecutionParameters(op, { scan_scope: 1 })).toEqual({ ok: true, parameters: { scan_scope: 1 } });
    expect(validateExecutionParameters(op, { scan_scope: "1" })).toEqual({ ok: true, parameters: { scan_scope: 1 } });
    expect(validateExecutionParameters(op, { scan_scope: true })).toEqual({ ok: false, reason: "invalid_scan_scope" });
  });

  it("requires a reboot countdown inside the documented range", () => {
    const op = operation("reboot", "endpoint_security");
    expect(validateExecutionParameters(op, {})).toEqual({ ok: false, reason: "missing_parameter:count_down_type" });
    expect(validateExecutionParameters(op, { count_down_type: 8 })).toEqual({ ok: false, reason: "invalid_count_down_type" });
    expect(validateExecutionParameters(op, { count_down_type: 1 })).toEqual({ ok: true, parameters: { count_down_type: 1 } });
  });

  it("restricts configuration assignment to a bounded identifier", () => {
    const op = operation("assign_config", "endpoint_security");
    expect(validateExecutionParameters(op, { config_id: "../../etc" })).toEqual({ ok: false, reason: "invalid_config_id" });
    expect(validateExecutionParameters(op, { config_id: "cfg-1" })).toEqual({ ok: true, parameters: { config_id: "cfg-1" } });
  });

  it("requires exactly one of pid or md5 for a process kill", () => {
    const op = operation("ts_kill_process", "threatsync");
    expect(validateExecutionParameters(op, {})).toEqual({ ok: false, reason: "kill_process_requires_pid_xor_md5" });
    expect(validateExecutionParameters(op, { pid: "10", md5: "a".repeat(32) })).toEqual({
      ok: false,
      reason: "kill_process_requires_pid_xor_md5",
    });
    expect(validateExecutionParameters(op, { md5: "A".repeat(32) })).toEqual({
      ok: true,
      parameters: { md5: "a".repeat(32) },
    });
  });

  it("validates addresses and incident status values", () => {
    expect(validateExecutionParameters(operation("ts_block_ip", "threatsync"), { address: "10.0.0.0/33" })).toEqual({
      ok: false,
      reason: "invalid_address",
    });
    expect(validateExecutionParameters(operation("ts_block_ip", "threatsync"), { address: "203.0.113.9" })).toEqual({
      ok: true,
      parameters: { address: "203.0.113.9" },
    });
    expect(validateExecutionParameters(operation("ts_incident_status", "threatsync"), { status: "deleted" })).toEqual({
      ok: false,
      reason: "invalid_incident_status",
    });
  });
});

describe("execution snapshot identity", () => {
  it("is order-independent for object keys", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("keeps array order material", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("changes when a parameter, target, or revision changes", () => {
    const base = baseSnapshot();
    const hash = executionSnapshotHash(base);
    expect(executionSnapshotHash(baseSnapshot({ parameters: { scan_scope: 1 } }))).not.toBe(hash);
    expect(executionSnapshotHash(baseSnapshot({
      target: { endpointId: 11, deviceId: "dev-2", entityId: null, providerIncidentId: null },
    }))).not.toBe(hash);
    expect(executionSnapshotHash(baseSnapshot({ credentialRevision: 9 }))).not.toBe(hash);
    expect(executionSnapshotHash(baseSnapshot({ evidenceGeneration: 6 }))).not.toBe(hash);
  });

  it("keeps the intent key stable across expiry and requester changes", () => {
    const base = baseSnapshot();
    const intent = executionIntentKey(base);
    expect(executionIntentKey(baseSnapshot({ expiresAt: 1_900_000_000_000 }))).toBe(intent);
    expect(executionIntentKey(baseSnapshot({ requesterId: 8 }))).toBe(intent);
    expect(executionIntentKey(baseSnapshot({ accountRevision: 4 }))).not.toBe(intent);
  });
});

describe("snapshot validation", () => {
  it("rejects an Endpoint Security action without a device id", () => {
    const result = validateExecutionSnapshot(baseSnapshot({
      target: { endpointId: 10, deviceId: null, entityId: null, providerIncidentId: null },
    }));
    expect(result).toEqual({ ok: false, reason: "missing_device_id" });
  });

  it("rejects a ThreatSync action without an entity id", () => {
    const result = validateExecutionSnapshot(baseSnapshot({
      namespace: "threatsync",
      actionType: "ts_quarantine",
      parameters: { md5: "a".repeat(32) },
      target: { endpointId: 10, deviceId: "dev-1", entityId: null, providerIncidentId: null },
    }));
    expect(result).toEqual({ ok: false, reason: "missing_entity_id" });
  });

  it("rejects an incident status change without a provider incident id", () => {
    const result = validateExecutionSnapshot(baseSnapshot({
      namespace: "threatsync",
      actionType: "ts_incident_status",
      parameters: { status: "closed" },
      target: { endpointId: 10, deviceId: null, entityId: "entity-1", providerIncidentId: null },
    }));
    expect(result).toEqual({ ok: false, reason: "missing_provider_incident" });
  });

  it("rejects actions that are not in the verified registry", () => {
    const result = validateExecutionSnapshot(baseSnapshot({ actionType: "uninstall" as never }));
    expect(result).toEqual({ ok: false, reason: "operation_not_verified" });
  });

  it("accepts a fully specified request and normalizes parameters", () => {
    const result = validateExecutionSnapshot(baseSnapshot({
      parameters: { scan_scope: 1 } as ExecutionParameters,
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.parameters).toEqual({ scan_scope: 1 });
  });

  it("rejects a mismatched namespace for a ThreatSync-only action", () => {
    const result = validateExecutionSnapshot(baseSnapshot({ actionType: "ts_quarantine" as never }));
    expect(result).toEqual({ ok: false, reason: "operation_not_verified" });
  });
});
