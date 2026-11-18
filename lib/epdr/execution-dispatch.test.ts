import { describe, expect, it } from "vitest";
import { getWriteOperation } from "./execution-capability";
import {
  aggregateScanJobStatuses,
  buildScanTaskName,
  classifyDispatchResponse,
  matchesScanTaskMarker,
  sanitizeResponseBody,
  scanTaskMarker,
} from "./execution-dispatch";

function op(actionType: string, namespace: "endpoint_security" | "threatsync" = "endpoint_security") {
  const found = getWriteOperation(namespace, actionType);
  if (!found) throw new Error(`missing ${namespace}/${actionType}`);
  return found;
}

describe("dispatch response classification", () => {
  it("never treats a timeout or a network failure as a rejection", () => {
    expect(classifyDispatchResponse({ operation: op("scan"), status: null, body: null, timedOut: true })).toEqual({
      kind: "outcome_unknown",
      reason: "client_timeout",
    });
    expect(classifyDispatchResponse({ operation: op("scan"), status: null, body: null, networkError: true })).toEqual({
      kind: "outcome_unknown",
      reason: "network_error",
    });
  });

  it("never treats a 5xx as a rejection", () => {
    expect(classifyDispatchResponse({ operation: op("isolate"), status: 503, body: null })).toEqual({
      kind: "outcome_unknown",
      reason: "http_503",
    });
  });

  it("treats documented client rejections as definite failures", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(classifyDispatchResponse({ operation: op("scan"), status, body: null })).toEqual({
        kind: "definite_reject",
        reason: `http_${status}`,
      });
    }
  });

  it("keeps a server-side request timeout ambiguous", () => {
    expect(classifyDispatchResponse({ operation: op("scan"), status: 408, body: null })).toEqual({
      kind: "outcome_unknown",
      reason: "http_408",
    });
  });

  it("extracts a scan task id from a documented acceptance", () => {
    const result = classifyDispatchResponse({ operation: op("scan"), status: 200, body: { task_id: "42" } });
    expect(result).toMatchObject({ kind: "accepted", providerRef: "42", providerJobId: "42" });
  });

  it("treats a 2xx without the documented receipt field as ambiguous", () => {
    expect(classifyDispatchResponse({ operation: op("scan"), status: 200, body: { ok: true } })).toEqual({
      kind: "outcome_unknown",
      reason: "missing_task_id",
    });
    expect(
      classifyDispatchResponse({ operation: op("isolate"), status: 200, body: { processed_device_ids: [] } }),
    ).toEqual({ kind: "outcome_unknown", reason: "empty_processed_device_ids" });
  });

  it("counts processed devices for isolation and reboot", () => {
    const result = classifyDispatchResponse({
      operation: op("isolate"),
      status: 200,
      body: { processed_device_ids: ["dev-1"] },
    });
    expect(result).toMatchObject({ kind: "accepted", affectedItems: 1 });
  });

  it("extracts a ThreatSync action reference", () => {
    const result = classifyDispatchResponse({
      operation: op("ts_quarantine", "threatsync"),
      status: 200,
      body: { id: "action-9" },
    });
    expect(result).toMatchObject({ kind: "accepted", providerRef: "action-9" });
  });

  it("refuses to follow a redirect", () => {
    expect(classifyDispatchResponse({ operation: op("scan"), status: 302, body: null })).toEqual({
      kind: "outcome_unknown",
      reason: "redirect_refused",
    });
  });
});

describe("response sanitization", () => {
  it("keeps only allowlisted receipt keys", () => {
    const sanitized = sanitizeResponseBody({
      task_id: "42",
      status: "performed",
      access_token: "should-not-survive",
      password: "should-not-survive",
      nested: { task_id: "nested" },
      list: Array.from({ length: 40 }, (_, index) => index),
    }) as Record<string, unknown>;
    expect(sanitized.task_id).toBe("42");
    expect(sanitized.status).toBe("performed");
    expect(sanitized).not.toHaveProperty("access_token");
    expect(sanitized).not.toHaveProperty("password");
    expect(sanitized).not.toHaveProperty("list");
  });

  it("keeps an allowlisted array bounded", () => {
    const sanitized = sanitizeResponseBody({
      processed_device_ids: Array.from({ length: 40 }, (_, index) => `d${index}`),
    }) as Record<string, unknown>;
    expect((sanitized.processed_device_ids as unknown[]).length).toBe(20);
  });
});

describe("scan correlation marker", () => {
  it("is bounded and charset safe", () => {
    expect(scanTaskMarker(12)).toBe("dcheck-12");
    const name = buildScanTaskName(12, "host name with spaces!");
    expect(name.startsWith("dcheck-12 ")).toBe(true);
    expect(name).not.toMatch(/[^A-Za-z0-9._ -]/);
    expect(name.length).toBeLessThanOrEqual(80);
  });

  it("matches only the exact request marker", () => {
    expect(matchesScanTaskMarker("dcheck-1 host", 1)).toBe(true);
    expect(matchesScanTaskMarker("dcheck-1", 1)).toBe(true);
    expect(matchesScanTaskMarker("dcheck-10 host", 1)).toBe(false);
    expect(matchesScanTaskMarker("prefix dcheck-1 host", 1)).toBe(false);
  });
});

describe("scan job aggregation", () => {
  it("requires every job to succeed", () => {
    expect(aggregateScanJobStatuses({ data: [{ status: 2 }, { status: 2 }] })).toBe("completed");
    expect(aggregateScanJobStatuses({ data: [{ status: 2 }, { status: 3 }] })).toBe("failed");
    expect(aggregateScanJobStatuses({ data: [{ status: 0 }] })).toBe("pending");
    expect(aggregateScanJobStatuses({ data: [] })).toBe("unreadable");
    expect(aggregateScanJobStatuses({ data: [{ status: 99 }] })).toBe("unreadable");
    expect(aggregateScanJobStatuses(null)).toBe("unreadable");
  });
});

describe("processed device acceptance", () => {
  it("rejects an acceptance list that does not mention the approved device", () => {
    expect(classifyDispatchResponse({
      operation: op("isolate"),
      status: 200,
      body: { processed_device_ids: ["other-device"] },
      expectedDeviceId: "approved-device",
    })).toEqual({ kind: "outcome_unknown", reason: "unexpected_processed_device_ids" });
  });

  it("accepts the approved device", () => {
    const result = classifyDispatchResponse({
      operation: op("isolate"),
      status: 200,
      body: { processed_device_ids: ["approved-device"] },
      expectedDeviceId: "approved-device",
    });
    expect(result.kind).toBe("accepted");
  });
});
