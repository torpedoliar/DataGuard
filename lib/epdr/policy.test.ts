import { describe, expect, it } from "vitest";
import { evaluate, type EndpointInput, type EvaluateInput, type GlobalControls, type RuleInput, type SiteControls } from "./policy";

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
    lastConnectionAt: new Date(),
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
    nowMs: Date.now(),
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
    expect(evaluate(input({ endpoint: endpoint({ lastConnectionAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) }) })).reasons[0]!.code).toBe("block_endpoint_offline");
    expect(evaluate(input({ site: site({ dataStale: true }) })).reasons[0]!.code).toBe("block_data_stale");
    expect(evaluate(input({ cooldownActive: true })).reasons[0]!.code).toBe("block_cooldown");
    expect(evaluate(input({ incident: { automationHold: false, exclusionActive: true } })).reasons[0]!.code).toBe("block_exclusion");
  });

  it("keeps simulation simulated even on a protected target", () => {
    const result = evaluate(input({ rule: baseRule({ executionMode: "simulate" }), endpoint: endpoint({ isCritical: true }) }));
    expect(result.decision).toBe("simulated");
    expect(result.effectiveMode).toBe("simulate");
  });

  it("approval mode always needs approval", () => {
    const result = evaluate(input({ rule: baseRule({ executionMode: "approval" }) }));
    expect(result.decision).toBe("needs_approval");
  });

  it("automatic downgrades server/critical/no_auto/unknown_type to needs_approval", () => {
    const cases: Array<[Partial<EndpointInput>, string]> = [
      [{ deviceType: 3 }, "approval_server"],
      [{ isCritical: true }, "approval_critical"],
      [{ noAuto: true }, "approval_no_auto"],
      [{ deviceType: null }, "approval_unknown_type"],
      [{ resolvedTarget: false }, "approval_unresolved_target"],
    ];
    for (const [ep, code] of cases) {
      const result = evaluate(input({ rule: baseRule({ deviceTypes: [] }), endpoint: endpoint(ep) }));
      expect(result.decision).toBe("needs_approval");
      expect(result.reasons.find((r) => r.code === code)).toBeTruthy();
    }
  });

  it("circuit breaker pauses automatic into needs_approval", () => {
    const result = evaluate(input({ site: site({ breakerPaused: true }) }));
    expect(result.decision).toBe("needs_approval");
    expect(result.reasons[0]!.code).toBe("breaker_paused");
  });

  it("validated workstation dispatches automatically", () => {
    const result = evaluate(input());
    expect(result.decision).toBe("automatic");
  });
});