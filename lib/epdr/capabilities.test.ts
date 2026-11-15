import { describe, expect, it } from "vitest";
import { EPDR_ACTION_TYPES } from "./action-types";
import { PROVIDER_CAPABILITIES, providerExecutionDecision } from "./capabilities";

describe("provider capability inventory", () => {
  it.each(EPDR_ACTION_TYPES)("keeps %s blocked regardless of its planned execution mode", (action) => {
    expect(providerExecutionDecision(action)).toBe("blocked_read_only");
  });
  it("does not invent repair or unknown command support", () => {
    expect(providerExecutionDecision("repair")).toBe("unsupported");
    expect(providerExecutionDecision("arbitrary_command")).toBe("unsupported");
    expect(PROVIDER_CAPABILITIES.every((item) => item.requiresCapabilityReview)).toBe(true);
  });
  it("proposes only scan for restricted automation, not reboot or disruptive actions", () => {
    expect(PROVIDER_CAPABILITIES.filter((item) => item.proposedMode === "restricted_scan").map((item) => item.action)).toEqual(["scan"]);
  });
});
