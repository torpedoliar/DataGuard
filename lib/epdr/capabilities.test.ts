import { describe, expect, it } from "vitest";
import { EPDR_ACTION_TYPES } from "./action-types";
import { EXECUTABLE_ACTION_TYPES, PROVIDER_CAPABILITIES, providerExecutionDecision } from "./capabilities";
import { WRITE_ACTION_TYPES, WRITE_OPERATIONS, getWriteOperation } from "./execution-capability";

describe("provider capability inventory", () => {
  it.each(EPDR_ACTION_TYPES)("marks %s as dispatchable only when it has a verified contract", (action) => {
    const verified = (WRITE_ACTION_TYPES as readonly string[]).includes(action);
    expect(providerExecutionDecision(action)).toBe(verified ? "verified_write" : "unsupported");
  });

  it("does not invent repair, comment, or unknown command support", () => {
    expect(providerExecutionDecision("repair")).toBe("unsupported");
    expect(providerExecutionDecision("provider_comment")).toBe("unsupported");
    expect(providerExecutionDecision("arbitrary_command")).toBe("unsupported");
    expect(PROVIDER_CAPABILITIES.every((item) => item.requiresCapabilityReview)).toBe(true);
  });

  it("records an explicit reason for every unsupported action", () => {
    for (const capability of PROVIDER_CAPABILITIES) {
      if (capability.execution === "unsupported") {
        expect(capability.unsupportedReason).toBeTruthy();
      } else {
        expect(capability.unsupportedReason).toBeNull();
      }
    }
  });

  it("keeps the executable list and the verified registry in sync", () => {
    expect([...EXECUTABLE_ACTION_TYPES].sort()).toEqual([...WRITE_ACTION_TYPES].sort());
  });

  it("never offers an operation without a documented method and path", () => {
    for (const operation of WRITE_OPERATIONS) {
      expect(["POST", "PATCH"]).toContain(operation.method);
      expect(operation.path.startsWith("/")).toBe(true);
      expect(getWriteOperation(operation.namespace, operation.actionType)).not.toBeNull();
    }
  });

  it("does not implement uninstall protection or batch transactions", () => {
    const actions = WRITE_OPERATIONS.map((operation) => operation.actionType);
    expect(actions).not.toContain("uninstall");
    expect(actions).not.toContain("transact");
  });
});
