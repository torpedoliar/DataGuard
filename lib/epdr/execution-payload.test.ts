import { describe, expect, it } from "vitest";
import { getWriteOperation } from "./execution-capability";
import { buildWriteBody, serializeWriteBody } from "./execution-payload";
import type { ExecutionSnapshot } from "./execution-request";

function snapshot(overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
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
    expiresAt: 2_000_000_000_000,
    ...overrides,
  };
}

const context = { requestId: 42, hostName: "HOST-A" };

function op(actionType: string, namespace: "endpoint_security" | "threatsync" = "endpoint_security") {
  const found = getWriteOperation(namespace, actionType);
  if (!found) throw new Error(`missing ${namespace}/${actionType}`);
  return found;
}

describe("write body construction", () => {
  it("targets exactly one device for every Endpoint Security action", () => {
    for (const action of ["scan", "isolate", "unisolate"]) {
      const result = buildWriteBody(op(action), snapshot(), context);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.body.device_ids).toEqual(["dev-1"]);
    }
  });

  it("refuses a fan-out to multiple or zero devices", () => {
    const none = buildWriteBody(
      op("isolate"),
      snapshot({ target: { endpointId: 10, deviceId: null, entityId: null, providerIncidentId: null } }),
      context,
    );
    expect(none).toEqual({ ok: false, reason: "invalid_target" });
  });

  it("embeds the correlation marker in the scan task name", () => {
    const result = buildWriteBody(op("scan"), snapshot(), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(String(result.body.task_name)).toBe("dcheck-42 HOST-A");
      expect(result.body.scan_scope).toBeUndefined();
    }
  });

  it("sends only documented fields, never unverified option flags", () => {
    const result = buildWriteBody(op("scan"), snapshot({ parameters: { scan_scope: 2 } }), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.body).sort()).toEqual(["device_ids", "scan_scope", "task_name"]);
    }
  });

  it("builds a reboot body with the documented action type", () => {
    const result = buildWriteBody(op("reboot"), snapshot({ parameters: { count_down_type: 3 } }), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({ device_ids: ["dev-1"], action_type: 1, count_down_type: 3 });
    }
  });

  it("puts the configuration id in the path, not the body", () => {
    const result = buildWriteBody(op("assign_config"), snapshot({ parameters: { config_id: "cfg-9" } }), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathParams).toEqual({ configId: "cfg-9" });
      expect(result.body).toEqual({ device_ids: ["dev-1"] });
    }
  });

  it("builds a ThreatSync command with the entity id and only its parameters", () => {
    const result = buildWriteBody(
      op("ts_quarantine", "threatsync"),
      snapshot({
        namespace: "threatsync",
        actionType: "ts_quarantine",
        parameters: { md5: "a".repeat(32) },
        target: { endpointId: 10, deviceId: null, entityId: "entity-7", providerIncidentId: null },
      }),
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({
        command: "quarantineFile",
        entityId: "entity-7",
        parameters: { md5: "a".repeat(32) },
      });
    }
  });

  it("rejects a ThreatSync entity id that equals the device id", () => {
    const result = buildWriteBody(
      op("ts_isolate", "threatsync"),
      snapshot({
        namespace: "threatsync",
        actionType: "ts_isolate",
        target: { endpointId: 10, deviceId: "same-id", entityId: "same-id", providerIncidentId: null },
      }),
      context,
    );
    expect(result).toEqual({ ok: false, reason: "entity_id_collides_with_device_id" });
  });

  it("requires an entity id for a ThreatSync command", () => {
    const result = buildWriteBody(
      op("ts_isolate", "threatsync"),
      snapshot({
        namespace: "threatsync",
        actionType: "ts_isolate",
        target: { endpointId: 10, deviceId: null, entityId: null, providerIncidentId: null },
      }),
      context,
    );
    expect(result).toEqual({ ok: false, reason: "missing_entity_id" });
  });

  it("builds an incident status body with the provider incident in the path", () => {
    const result = buildWriteBody(
      op("ts_incident_status", "threatsync"),
      snapshot({
        namespace: "threatsync",
        actionType: "ts_incident_status",
        parameters: { status: "closed" },
        target: { endpointId: 10, deviceId: null, entityId: null, providerIncidentId: "inc-5" },
      }),
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({ status: "closed" });
      expect(result.pathParams).toEqual({ providerIncidentId: "inc-5" });
    }
  });

  it("serializes deterministically for hashing", () => {
    expect(serializeWriteBody({ a: 1, b: 2 })).toBe(serializeWriteBody({ a: 1, b: 2 }));
  });
});
