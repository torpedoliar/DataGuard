import { describe, expect, it } from "vitest";
import { RESEED_CONFLICT_UPDATE_KEYS } from "./rule-runner";

describe("RESEED_CONFLICT_UPDATE_KEYS", () => {
  it("updates rule metadata from code on re-seed", () => {
    for (const key of ["name", "description", "severity", "category", "ruleType", "conditions", "groupBy", "threshold", "windowSeconds", "cooldownSeconds"]) {
      expect(RESEED_CONFLICT_UPDATE_KEYS).toContain(key);
    }
  });

  it("never overwrites user-controlled toggles on re-seed", () => {
    expect(RESEED_CONFLICT_UPDATE_KEYS).not.toContain("enabled");
    expect(RESEED_CONFLICT_UPDATE_KEYS).not.toContain("alertEnabled");
  });
});
