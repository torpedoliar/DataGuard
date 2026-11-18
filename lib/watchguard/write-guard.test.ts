import { describe, expect, it } from "vitest";
import { getWriteOperation, type WriteOperation } from "@/lib/epdr/execution-capability";
import { classifyWriteOutbound, resolveWriteTarget } from "./write-guard";

const ACCOUNT = "WGC-3-123456";

function op(actionType: string, namespace: "endpoint_security" | "threatsync" = "endpoint_security"): WriteOperation {
  const found = getWriteOperation(namespace, actionType);
  if (!found) throw new Error(`missing ${namespace}/${actionType}`);
  return found;
}

function base(overrides: Partial<Parameters<typeof classifyWriteOutbound>[0]> = {}) {
  return {
    operation: op("scan"),
    accountId: ACCOUNT,
    region: "jpn",
    pathParams: {},
    credentialMode: "write" as const,
    enabled: true,
    ...overrides,
  };
}

describe("write guard", () => {
  it("refuses every write while enablement is off", () => {
    for (const operation of [
      op("scan"), op("isolate"), op("unisolate"), op("reboot"),
      op("assign_config"), op("ts_quarantine", "threatsync"),
    ]) {
      expect(classifyWriteOutbound(base({ operation, enabled: false }))).toEqual({
        allowed: false,
        reason: "write_disabled",
      });
    }
  });

  it("refuses a write that resolved the read-only credential pair", () => {
    expect(classifyWriteOutbound(base({ credentialMode: "read" }))).toEqual({
      allowed: false,
      reason: "read_credentials",
    });
  });

  it("builds the exact documented path for each namespace", () => {
    const scan = classifyWriteOutbound(base());
    expect(scan.allowed).toBe(true);
    if (scan.allowed) {
      expect(scan.path).toBe(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/immediatescan`);
      expect(scan.method).toBe("POST");
      expect(scan.url.hostname).toBe("api.jpn.cloud.watchguard.com");
    }
    const status = classifyWriteOutbound(base({
      operation: op("ts_incident_status", "threatsync"),
      pathParams: { providerIncidentId: "inc-1" },
    }));
    expect(status.allowed).toBe(true);
    if (status.allowed) {
      expect(status.path).toBe(`/rest/threatsync/management/v1/${ACCOUNT}/incidents/inc-1`);
      expect(status.method).toBe("PATCH");
    }
  });

  it("requires the path parameter and rejects traversal or separators", () => {
    const config = op("assign_config");
    expect(classifyWriteOutbound(base({ operation: config }))).toEqual({
      allowed: false,
      reason: "missing_path_parameter",
    });
    expect(classifyWriteOutbound(base({ operation: config, pathParams: { configId: "../../etc" } }))).toEqual({
      allowed: false,
      reason: "invalid_path_parameter",
    });
    expect(classifyWriteOutbound(base({ operation: config, pathParams: { configId: "a/b" } }))).toEqual({
      allowed: false,
      reason: "invalid_path_parameter",
    });
    expect(classifyWriteOutbound(base({ operation: config, pathParams: { configId: "cfg-1" } })).allowed).toBe(true);
  });

  it("rejects an unknown region and a malformed account", () => {
    expect(classifyWriteOutbound(base({ region: "mars" }))).toEqual({ allowed: false, reason: "unknown_region" });
    expect(classifyWriteOutbound(base({ accountId: "acct/../x" }))).toEqual({
      allowed: false,
      reason: "invalid_account",
    });
    expect(classifyWriteOutbound(base({ accountId: "" }))).toEqual({ allowed: false, reason: "invalid_account" });
  });

  it("rejects an operation that was tampered with after registration", () => {
    const forged = { ...op("scan"), path: "/../oauth/token" } as WriteOperation;
    expect(classifyWriteOutbound(base({ operation: forged }))).toEqual({
      allowed: false,
      reason: "operation_not_registered",
    });
    const unregistered = { ...op("scan"), actionType: "uninstall" } as unknown as WriteOperation;
    expect(classifyWriteOutbound(base({ operation: unregistered }))).toEqual({
      allowed: false,
      reason: "operation_not_registered",
    });
  });

  it("never produces a URL with a query, fragment, userinfo, or trailing slash", () => {
    const target = resolveWriteTarget(base());
    expect(target.ok).toBe(true);
    if (target.ok) {
      const url = new URL(target.url);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.port).toBe("");
    }
  });
});
