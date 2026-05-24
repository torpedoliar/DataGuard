import { describe, expect, it } from "vitest";
import { buildFindingText, buildHumanAnalysis, buildRecommendedAction } from "./human-analysis";
import type { SiemFindingCandidate, SiemRuleDefinition } from "./rule-engine";

const rule: Pick<SiemRuleDefinition, "name" | "description" | "category" | "severity" | "ruleType" | "threshold" | "windowSeconds" | "groupBy"> = {
  name: "Failed login spike",
  description: "Repeated failed logins from the same source.",
  category: "Authentication",
  severity: "High",
  ruleType: "threshold",
  threshold: 5,
  windowSeconds: 300,
  groupBy: ["deviceId", "srcIp", "username"],
};

const candidate: SiemFindingCandidate = {
  ruleId: 1,
  ruleKey: "auth.failed_login_spike",
  title: "Failed login spike: admin",
  summary: "Matched 5 events.",
  severity: "High",
  siteId: 10,
  deviceId: 100,
  sourceId: 200,
  eventCount: 5,
  firstSeenAt: new Date("2026-05-24T01:00:00.000Z"),
  lastSeenAt: new Date("2026-05-24T01:04:00.000Z"),
  sampleEventIds: [1, 2, 3, 4, 5],
  correlationKey: "auth.failed_login_spike|deviceId:100|srcIp:192.0.2.10|username:admin",
};

describe("human analysis", () => {
  it("builds evidence-only analysis from rule and finding data", () => {
    expect(buildHumanAnalysis({ candidate, rule })).toBe("High Authentication finding: Failed login spike. 5 matching event(s) were observed for device #100, source #200, site #10 in 5 minute window. First seen 2026-05-24T01:00:00.000Z; last seen 2026-05-24T01:04:00.000Z. Rule evidence: Repeated failed logins from the same source.");
  });

  it("blocks incident escalation recommendation until source maps to a device", () => {
    expect(buildRecommendedAction({ candidate: { ...candidate, deviceId: null }, rule })).toBe("Map the syslog source to a device before creating or escalating an incident.");
  });

  it("returns category-specific action", () => {
    expect(buildFindingText({ candidate, rule }).recommendedAction).toContain("Review login source");
  });
});
