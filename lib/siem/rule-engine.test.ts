import { describe, expect, it } from "vitest";
import { buildCorrelationKey, evaluateAbsence, evaluateBaseline, evaluateSiemRules, eventMatchesRule, type SiemRuleDefinition, type SiemRuleEvent } from "./rule-engine";

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

describe("evaluateAbsence", () => {
  const absenceRule: SiemRuleDefinition = {
    ...baseRule,
    id: 10,
    key: "health.source_silent",
    name: "Syslog source silent",
    description: "Expected syslog source stopped sending logs.",
    severity: "High",
    category: "SIEM Health",
    ruleType: "absence",
    conditions: { normalizedTypes: [] },
    groupBy: ["sourceId"],
    threshold: null,
    windowSeconds: 1800,
  };

  const now = new Date("2026-05-24T00:30:00.000Z");

  it("emits a finding for every expected sourceId that has no events in the window", () => {
    const expectedSourceIds = [200, 201, 202];
    const events = [
      event({ id: 1, sourceId: 201, receivedAt: new Date("2026-05-24T00:29:00.000Z") }),
    ];

    const findings = evaluateAbsence(absenceRule, events, { now, expectedSourceIds });

    expect(findings).toHaveLength(2);
    const sourceIds = findings.map((f) => f.sourceId).sort();
    expect(sourceIds).toEqual([200, 202]);
    expect(findings[0]?.eventCount).toBe(0);
    expect(findings[0]?.correlationKey).toBe("health.source_silent|sourceId:200");
  });

  it("returns no findings when every expected sourceId has events in the window", () => {
    const expectedSourceIds = [200, 201];
    const events = [
      event({ id: 1, sourceId: 200, receivedAt: new Date("2026-05-24T00:29:00.000Z") }),
      event({ id: 2, sourceId: 201, receivedAt: new Date("2026-05-24T00:29:30.000Z") }),
    ];

    expect(evaluateAbsence(absenceRule, events, { now, expectedSourceIds })).toEqual([]);
  });

  it("returns no findings when the rule is disabled", () => {
    const disabledRule = { ...absenceRule, enabled: false };
    const expectedSourceIds = [200, 201, 202];
    const events: SiemRuleEvent[] = [];

    expect(evaluateAbsence(disabledRule, events, { now, expectedSourceIds })).toEqual([]);
  });
});

describe("evaluateBaseline", () => {
  const baselineRule: SiemRuleDefinition = {
    ...baseRule,
    id: 11,
    key: "health.log_volume_spike",
    name: "Sudden log volume spike",
    description: "Source emits far more logs than recent baseline.",
    severity: "Medium",
    category: "SIEM Health",
    ruleType: "baseline_anomaly",
    conditions: { normalizedTypes: [] },
    groupBy: ["sourceId"],
    threshold: 3,
    windowSeconds: 900,
  };

  const now = new Date("2026-05-24T00:30:00.000Z");

  it("emits a finding when current 15m count exceeds threshold × baseline hourly average", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      event({ id: 1000 + i, sourceId: 200, receivedAt: new Date(now.getTime() - (50 - i) * 1000) }),
    );
    const baseline = { sourceId: 200, avgPerHour: 10 };

    const findings = evaluateBaseline(baselineRule, events, { now, baselineBySource: new Map([[200, baseline]]) });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceId).toBe(200);
    expect(findings[0]?.eventCount).toBe(50);
    expect(findings[0]?.correlationKey).toBe("health.log_volume_spike|sourceId:200");
  });

  it("returns no findings when current 15m count is at or below threshold × baseline", () => {
    // baseline 10/h × threshold 3 × window 0.25h = 7.5 events max before alert
    const events = Array.from({ length: 5 }, (_, i) =>
      event({ id: 2000 + i, sourceId: 200, receivedAt: new Date(now.getTime() - (5 - i) * 1000) }),
    );
    const baseline = { sourceId: 200, avgPerHour: 10 };

    expect(evaluateBaseline(baselineRule, events, { now, baselineBySource: new Map([[200, baseline]]) })).toEqual([]);
  });

  it("does not fire at the boundary (current = 7) just below threshold × baseline", () => {
    // baseline 10/h × threshold 3 × window 0.25h = 7.5; current=7 must not fire
    const events = Array.from({ length: 7 }, (_, i) =>
      event({ id: 4000 + i, sourceId: 200, receivedAt: new Date(now.getTime() - (7 - i) * 1000) }),
    );
    const baseline = { sourceId: 200, avgPerHour: 10 };

    expect(evaluateBaseline(baselineRule, events, { now, baselineBySource: new Map([[200, baseline]]) })).toEqual([]);
  });

  it("fires at the boundary (current = 8) just above threshold × baseline", () => {
    // baseline 10/h × threshold 3 × window 0.25h = 7.5; current=8 must fire
    const events = Array.from({ length: 8 }, (_, i) =>
      event({ id: 5000 + i, sourceId: 200, receivedAt: new Date(now.getTime() - (8 - i) * 1000) }),
    );
    const baseline = { sourceId: 200, avgPerHour: 10 };

    const findings = evaluateBaseline(baselineRule, events, { now, baselineBySource: new Map([[200, baseline]]) });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.eventCount).toBe(8);
  });

  it("returns no findings when the rule is disabled", () => {
    const disabledRule = { ...baselineRule, enabled: false };
    const events = Array.from({ length: 50 }, (_, i) =>
      event({ id: 3000 + i, sourceId: 200, receivedAt: new Date(now.getTime() - (50 - i) * 1000) }),
    );
    const baseline = { sourceId: 200, avgPerHour: 10 };

    expect(evaluateBaseline(disabledRule, events, { now, baselineBySource: new Map([[200, baseline]]) })).toEqual([]);
  });
});
