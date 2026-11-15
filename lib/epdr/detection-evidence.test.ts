import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyOutbound } from "@/lib/watchguard/guard";
import { WATCHGUARD_REGIONS } from "@/lib/watchguard/regions";
import { detectionCompleteness, eventExportReadStatus, detectionSourceReadSupported, DETECTION_SOURCE_READ_CAPABILITIES, REQUIRED_EVENT_EXPORT_TYPES, type DetectionReadEvidence } from "./detection-evidence";

const context = { settingsUpdatedAt: new Date(100), connectionId: 1, accountRevision: 2, credentialRevision: 3, source: "threatsync" as const, enabled: true, supportVerified: true, now: 1000, maxAgeMs: 500 };
const evidence: DetectionReadEvidence = { settingsUpdatedAt: new Date(100), connectionId: 1, accountRevision: 2, credentialRevision: 3, source: "threatsync", status: "completed", window: "provider_default", startedAt: new Date(600), finishedAt: new Date(900), eventTypes: [], completedEventTypes: [] };
const status = (row = evidence, ctx = context) => detectionCompleteness(row, ctx).completeness.status;
describe("source detection read provenance", () => {
  it("uses only documented source read capabilities, without caller verification", () => {
    expect(detectionSourceReadSupported("threatsync")).toBe(true);
    expect(detectionSourceReadSupported("event_export")).toBe(true);
    expect(detectionSourceReadSupported("health")).toBe(false);
    expect(detectionSourceReadSupported("toString")).toBe(false);
    expect(DETECTION_SOURCE_READ_CAPABILITIES.threatsync.method).toBe("GET");
    expect(detectionCompleteness(evidence, { ...context, supportVerified: undefined }).completeness.status).toBe("verified");
  });
  it("keeps each registry entry aligned with repository docs and the read guard", () => {
    const docs = readFileSync(resolve(process.cwd(), "docs/superpowers/plans/2026-11-09-watchguard-epdr/T01-api-client.md"), "utf8");
    expect(docs).toContain("exportSecurityEvents(type, period");
    expect(docs).toContain("listIncidents({ limit, duration");
    for (const capability of Object.values(DETECTION_SOURCE_READ_CAPABILITIES)) {
      const path = capability.route.replace("{accountId}", "account").replace("{type}", "1").replace("{period}", "1");
      expect(classifyOutbound("GET", `https://${WATCHGUARD_REGIONS.usa}${path}`).allowed).toBe(true);
      expect(classifyOutbound("POST", `https://${WATCHGUARD_REGIONS.usa}${path}`).allowed).toBe(false);
    }
  });
  it("revokes old evidence after settings save/off-on even when currently enabled", () => {
    expect(status(evidence, { ...context, settingsUpdatedAt: new Date(200) })).toBe("unknown");
    expect(status({ ...evidence, settingsUpdatedAt: null })).toBe("unknown");
  });
  it("requires persisted evidence, enabled source and independently verified support", () => {
    expect(detectionCompleteness(null, context).completeness.status).toBe("unknown");
    expect(status(evidence, { ...context, supportVerified: false })).toBe("unknown");
    expect(status(evidence, { ...context, enabled: false })).toBe("unknown");
    expect(status()).toBe("verified");
  });
  it.each(["partial", "failed"])("never verifies a %s read", (readStatus) => {
    expect(status({ ...evidence, status: readStatus })).toBe("partial");
    expect(detectionCompleteness({ ...evidence, status: readStatus }, context).syncedAt).toBeNull();
  });
  it.each([{ accountRevision: 4 }, { credentialRevision: 4 }, { connectionId: 4 }, { source: "event_export" }, { window: "guessed" }])("rejects mismatched binding/scope %j", (change) => {
    expect(status({ ...evidence, ...change })).toBe("unknown");
  });
  it.each([{ startedAt: new Date(0) }, { finishedAt: new Date(1001) }, { startedAt: new Date(950) }, { finishedAt: new Date(NaN) }])("rejects stale or invalid freshness %j", (change) => {
    expect(status({ ...evidence, ...change })).toBe("unknown");
  });
  it("requires all EventExport types, including exhausted empty types", () => {
    const required = [...REQUIRED_EVENT_EXPORT_TYPES];
    expect(eventExportReadStatus(required, required)).toBe("completed");
    expect(eventExportReadStatus([1], [1])).toBe("partial");
    expect(eventExportReadStatus(required, [1, 2, 4, 6])).toBe("partial");
    expect(eventExportReadStatus(required, [])).toBe("failed");
    expect(eventExportReadStatus([], [])).toBe("partial");
    const row = { ...evidence, source: "event_export", window: "event_export_period_1", eventTypes: required, completedEventTypes: required };
    const ctx = { ...context, source: "event_export" as const };
    expect(detectionCompleteness(row, ctx).completeness.status).toBe("verified");
    expect(detectionCompleteness({ ...row, completedEventTypes: [1] }, ctx).completeness.status).toBe("partial");
  });
});
