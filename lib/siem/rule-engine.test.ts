import { describe, expect, it } from "vitest";
import { buildCorrelationKey, evaluateSiemRules, eventMatchesRule, type SiemRuleDefinition, type SiemRuleEvent } from "./rule-engine";

const baseRule: SiemRuleDefinition = {
  id: 1,
  key: "auth.failed_login_spike",
  name: "Failed login spike",
  description: "Repeated failed logins from the same source.",
  enabled: true,
  severity: "High",
  category: "Authentication",
  ruleType: "threshold",
  conditions: { normalizedTypes: ["auth_failed"] },
  groupBy: ["deviceId", "srcIp", "username"],
  threshold: 3,
  windowSeconds: 300,
  cooldownSeconds: 300,
};

function event(input: Partial<SiemRuleEvent>): SiemRuleEvent {
  return {
    id: input.id ?? 1,
    receivedAt: input.receivedAt ?? new Date("2026-05-24T00:00:00.000Z"),
    siteId: input.siteId ?? 10,
    deviceId: input.deviceId ?? 100,
    sourceId: input.sourceId ?? 200,
    sourceIp: input.sourceIp ?? "10.0.0.10",
    normalizedType: input.normalizedType ?? "auth_failed",
    action: input.action ?? "login",
    outcome: input.outcome ?? "failure",
    srcIp: input.srcIp ?? "192.0.2.10",
    srcPort: input.srcPort ?? null,
    dstIp: input.dstIp ?? null,
    dstPort: input.dstPort ?? null,
    username: input.username ?? "admin",
    interfaceName: input.interfaceName ?? null,
    protocol: input.protocol ?? null,
    program: input.program ?? null,
    tags: input.tags ?? [],
  };
}

describe("eventMatchesRule", () => {
  it("matches normalized type, outcome, and tags", () => {
    const rule = { ...baseRule, conditions: { normalizedTypes: ["auth_failed"], outcomes: ["failure"], tags: ["vpn"] } };

    expect(eventMatchesRule(rule, event({ tags: ["vpn", "remote"] }))).toBe(true);
    expect(eventMatchesRule(rule, event({ tags: ["remote"] }))).toBe(false);
  });
});

describe("buildCorrelationKey", () => {
  it("uses configured group fields", () => {
    expect(buildCorrelationKey(baseRule, event({}))).toBe("auth.failed_login_spike|deviceId:100|srcIp:192.0.2.10|username:admin");
  });
});

describe("evaluateSiemRules", () => {
  it("creates single-event findings", () => {
    const rule = { ...baseRule, id: 2, key: "system.device_reboot", name: "Device reboot", ruleType: "single_event" as const, conditions: { normalizedTypes: ["device_reboot"] }, groupBy: ["deviceId"], threshold: null, windowSeconds: null };

    const findings = evaluateSiemRules({ rules: [rule], events: [event({ id: 9, normalizedType: "device_reboot" })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 2, eventCount: 1, sampleEventIds: [9], correlationKey: "system.device_reboot|deviceId:100" });
  });

  it("creates threshold findings inside configured window", () => {
    const events = [0, 60, 120].map((seconds, index) => event({ id: index + 1, receivedAt: new Date(Date.UTC(2026, 4, 24, 0, 0, seconds)) }));

    const findings = evaluateSiemRules({ rules: [baseRule], events });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ eventCount: 3, sampleEventIds: [1, 2, 3], severity: "High" });
  });

  it("does not create threshold findings when events are outside window", () => {
    const events = [0, 400, 800].map((seconds, index) => event({ id: index + 1, receivedAt: new Date(Date.UTC(2026, 4, 24, 0, 0, seconds)) }));

    expect(evaluateSiemRules({ rules: [baseRule], events })).toEqual([]);
  });

  it("creates sequence finding when success follows repeated failures", () => {
    const rule = { ...baseRule, id: 3, key: "auth.success_after_failures", name: "Success after failures", ruleType: "sequence" as const, conditions: { normalizedTypes: ["auth_failed", "auth_success"] }, threshold: 2, windowSeconds: 600 };
    const events = [
      event({ id: 1, normalizedType: "auth_failed", receivedAt: new Date("2026-05-24T00:00:00.000Z") }),
      event({ id: 2, normalizedType: "auth_failed", receivedAt: new Date("2026-05-24T00:01:00.000Z") }),
      event({ id: 3, normalizedType: "auth_success", outcome: "success", receivedAt: new Date("2026-05-24T00:02:00.000Z") }),
    ];

    const findings = evaluateSiemRules({ rules: [rule], events });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.sampleEventIds).toEqual([1, 2, 3]);
  });
});
