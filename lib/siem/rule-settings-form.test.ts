import { describe, expect, it } from "vitest";
import { clampRuleToggle, parseSiemRulesFormData } from "./rule-settings-form";

describe("clampRuleToggle", () => {
  it("keeps alertEnabled when the rule is enabled", () => {
    expect(clampRuleToggle({ id: 1, enabled: true, alertEnabled: true })).toEqual({ id: 1, enabled: true, alertEnabled: true });
  });

  it("forces alertEnabled off when the rule is disabled", () => {
    expect(clampRuleToggle({ id: 2, enabled: false, alertEnabled: true })).toEqual({ id: 2, enabled: false, alertEnabled: false });
  });
});

describe("parseSiemRulesFormData", () => {
  it("reads ruleIds and per-rule checkboxes, clamping alert to enabled", () => {
    const fd = new FormData();
    fd.set("ruleIds", "1,2,3");
    fd.set("alertMinSeverity", "Low");
    // rule 1: enabled + alert
    fd.set("enabled-1", "on");
    fd.set("alert-1", "on");
    // rule 2: enabled only
    fd.set("enabled-2", "on");
    // rule 3: disabled but alert checked -> clamped off
    fd.set("alert-3", "on");

    const result = parseSiemRulesFormData(fd);
    expect(result.alertMinSeverity).toBe("Low");
    expect(result.rules).toEqual([
      { id: 1, enabled: true, alertEnabled: true },
      { id: 2, enabled: true, alertEnabled: false },
      { id: 3, enabled: false, alertEnabled: false },
    ]);
  });

  it("throws on an invalid alertMinSeverity", () => {
    const fd = new FormData();
    fd.set("ruleIds", "1");
    fd.set("alertMinSeverity", "Bogus");
    fd.set("enabled-1", "on");
    expect(() => parseSiemRulesFormData(fd)).toThrow();
  });

  it("ignores empty ruleIds", () => {
    const fd = new FormData();
    fd.set("ruleIds", "");
    fd.set("alertMinSeverity", "High");
    const result = parseSiemRulesFormData(fd);
    expect(result.rules).toEqual([]);
  });
});
