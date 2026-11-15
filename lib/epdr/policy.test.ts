import { describe, expect, it } from "vitest";
import { evaluate, type EndpointInput, type EvaluateInput, type GlobalControls, type RuleInput, type SiteControls } from "./policy";

const NOW_MS = Date.UTC(2026, 0, 15);
const DAY_MS = 24 * 60 * 60 * 1000;

function baseRule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    enabled: true,
    trigger: "detection",
    categories: ["malware", "pup", "exploit", "virus", "ioa"],
    minScore: null,
    maxScore: null,
    deviceTypes: [1, 2],
    actionType: "scan",
    executionMode: "automatic",
    ...overrides,
  };
}

function endpoint(overrides: Partial<EndpointInput> = {}): EndpointInput {
  return {
    deviceType: 1,
    isCritical: false,
    assetCritical: false,
    noAuto: false,
    removedAt: null,
    lastConnectionAt: new Date(NOW_MS),
    resolvedTarget: true,
    ...overrides,
  };
}

function site(overrides: Partial<SiteControls> = {}): SiteControls {
  return { killSwitch: false, breakerPaused: false, dataStale: false, ...overrides };
}

function global(overrides: Partial<GlobalControls> = {}): GlobalControls {
  return { killSwitch: false, allowedActions: ["scan"], ...overrides };
}

function input(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    detection: { category: "malware", threatScore: null },
    endpoint: endpoint(),
    incident: { automationHold: false, exclusionActive: false },
    rule: baseRule(),
    site: site(),
    global: global(),
    nowMs: NOW_MS,
    cooldownActive: false,
    ...overrides,
  };
}

describe("evaluate", () => {
  it("returns no_match for disabled rule or category/score mismatch", () => {
    expect(evaluate(input({ rule: baseRule({ enabled: false }) })).decision).toBe("no_match");
    expect(evaluate(input({ rule: baseRule({ categories: ["ioa"] }) })).decision).toBe("no_match");
    expect(evaluate(input({ rule: baseRule({ minScore: 7, maxScore: 10 }), detection: { category: "malware", threatScore: 5 } })).decision).toBe("no_match");
  });

  it("returns blocked for kill switches and action not allowed", () => {
    const gk = evaluate(input({ global: global({ killSwitch: true }) }));
    expect(gk.decision).toBe("blocked");
    expect(gk.reasons[0]!.code).toBe("block_kill_switch_global");

    const sk = evaluate(input({ site: site({ killSwitch: true }) }));
    expect(sk.reasons[0]!.code).toBe("block_kill_switch_site");

    const na = evaluate(input({ global: global({ allowedActions: ["reboot"] }) }));
    expect(na.reasons[0]!.code).toBe("block_action_not_allowed");
  });

  it("returns blocked for hold, removed, offline, stale, cooldown and exclusion", () => {
    expect(evaluate(input({ incident: { automationHold: true, exclusionActive: false } })).reasons[0]!.code).toBe("block_automation_hold");
    expect(evaluate(input({ endpoint: endpoint({ removedAt: new Date() }) })).reasons[0]!.code).toBe("block_endpoint_removed");
    expect(evaluate(input({ endpoint: endpoint({ lastConnectionAt: new Date(NOW_MS - 8 * DAY_MS) }) })).reasons[0]!.code).toBe("block_endpoint_offline");
    expect(evaluate(input({ site: site({ dataStale: true }) })).reasons[0]!.code).toBe("block_data_stale");
    expect(evaluate(input({ cooldownActive: true })).reasons[0]!.code).toBe("block_cooldown");
    expect(evaluate(input({ incident: { automationHold: false, exclusionActive: true } })).reasons[0]!.code).toBe("block_exclusion");
  });

  it("keeps simulation simulated even on a protected target", () => {
    const result = evaluate(input({ rule: baseRule({ executionMode: "simulate" }), endpoint: endpoint({ isCritical: true }) }));
    expect(result.decision).toBe("simulated");
    expect(result.effectiveMode).toBe("simulate");
  });

  it.each(["simulate", "approval", "automatic"] as const)("keeps requested %s mode inert under read-only", (executionMode) => {
    const result = evaluate(input({ rule: baseRule({ executionMode }) }));
    expect(result.decision).toBe("simulated");
    expect(result.effectiveMode).toBe("simulate");
    expect(result.reasons).toContainEqual({
      code: "simulated",
      detail: `WatchGuard READ-ONLY; requested ${executionMode}; no provider dispatch or replay authorization`,
    });
  });

  it("records server/critical/no_auto/unknown_type guardrails without live proposals", () => {
    const cases: Array<[Partial<EndpointInput>, string]> = [
      [{ deviceType: 3 }, "approval_server"],
      [{ isCritical: true }, "approval_critical"],
      [{ noAuto: true }, "approval_no_auto"],
      [{ deviceType: null }, "approval_unknown_type"],
      [{ assetCritical: true }, "approval_critical"],
    ];
    for (const [ep, code] of cases) {
      const result = evaluate(input({ rule: baseRule({ deviceTypes: [] }), endpoint: endpoint(ep) }));
      expect(result.decision).toBe("simulated");
      expect(result.effectiveMode).toBe("simulate");
      expect(result.reasons.find((r) => r.code === code)).toBeTruthy();
    }
  });

  it("records a paused circuit breaker without creating an approval proposal", () => {
    const result = evaluate(input({ site: site({ breakerPaused: true }) }));
    expect(result.decision).toBe("simulated");
    expect(result.effectiveMode).toBe("simulate");
    expect(result.reasons[0]!.code).toBe("breaker_paused");
  });

  describe.each(["simulate", "approval", "automatic"] as const)("hard blocks in %s mode", (executionMode) => {
    it.each([
      ["unresolved identity", { resolvedTarget: false }, "approval_unresolved_target"],
      ["removed endpoint", { removedAt: new Date(NOW_MS) }, "block_endpoint_removed"],
      ["offline endpoint", { lastConnectionAt: new Date(NOW_MS - 8 * DAY_MS) }, "block_endpoint_offline"],
      ["unknown contact", { lastConnectionAt: null }, "block_endpoint_offline"],
      ["invalid contact", { lastConnectionAt: new Date(NaN) }, "block_data_stale"],
      ["future contact", { lastConnectionAt: new Date(NOW_MS + 1) }, "block_data_stale"],
    ] satisfies Array<[string, Partial<EndpointInput>, string]>)("does not allow approval to bypass %s", (_label, ep, code) => {
      const result = evaluate(input({ rule: baseRule({ executionMode }), endpoint: endpoint(ep) }));
      expect(result.decision).toBe("blocked");
      expect(result.effectiveMode).toBe("simulate");
      expect(result.reasons.some((r) => r.code === code)).toBe(true);
    });

    it("blocks stale identity data even for a protected target", () => {
      const result = evaluate(input({
        rule: baseRule({ executionMode }),
        endpoint: endpoint({ isCritical: true, resolvedTarget: false }),
        site: site({ dataStale: true }),
      }));
      expect(result.decision).toBe("blocked");
      expect(result.reasons.map((r) => r.code)).toEqual(["approval_unresolved_target", "block_data_stale"]);
    });
  });

  it("distinguishes unknown contact in its existing typed reason detail", () => {
    expect(evaluate(input({ endpoint: endpoint({ lastConnectionAt: null }) })).reasons)
      .toContainEqual({ code: "block_endpoint_offline", detail: "last contact unknown" });
  });

  it("preserves the exact seven-day boundary for known contact", () => {
    const result = evaluate(input({ endpoint: endpoint({ lastConnectionAt: new Date(NOW_MS - 7 * DAY_MS) }) }));
    expect(result.decision).toBe("simulated");
  });

  it.each([NaN, Infinity, -Infinity])("blocks an invalid evaluation clock %s", (nowMs) => {
    expect(evaluate(input({ nowMs })).decision).toBe("blocked");
  });

  it.each(["scan", "isolate", "reboot", "assign"])("never grants provider execution for allowed action %s", (actionType) => {
    const result = evaluate(input({ rule: baseRule({ actionType }), global: global({ allowedActions: [actionType] }) }));
    expect(result.decision).toBe("simulated");
    expect(result.effectiveMode).toBe("simulate");
  });
});