import { describe, expect, it } from "vitest";
import { SIEM_ATTACK_TACTICS } from "./attack-tactics";
import { ATTACK_TACTIC_INFO, ATTACK_TECHNIQUE_INFO, ISO_CONTROL_INFO } from "./coverage-reference";
import { DEFAULT_SIEM_RULES } from "./default-rules";

describe("coverage reference data", () => {
  it("describes every tactic the matrix renders", () => {
    for (const tactic of SIEM_ATTACK_TACTICS) {
      const info = ATTACK_TACTIC_INFO[tactic];
      expect(info, `missing tactic info for ${tactic}`).toBeDefined();
      expect(info.description.length).toBeGreaterThan(20);
      expect(info.url).toMatch(/^https:\/\/attack\.mitre\.org\/tactics\/TA\d{4}\/$/);
    }
  });

  it("describes every technique referenced by default rules", () => {
    const used = new Set(DEFAULT_SIEM_RULES.flatMap((rule) => rule.mitreTechniques));
    for (const technique of used) {
      expect(ATTACK_TECHNIQUE_INFO[technique], `missing technique info for ${technique}`).toBeDefined();
    }
  });

  it("describes every ISO control referenced by default rules", () => {
    const used = new Set(DEFAULT_SIEM_RULES.flatMap((rule) => rule.isoControls));
    for (const control of used) {
      expect(ISO_CONTROL_INFO[control], `missing ISO control info for ${control}`).toBeDefined();
      expect(ISO_CONTROL_INFO[control].title.length).toBeGreaterThan(3);
    }
  });
});
