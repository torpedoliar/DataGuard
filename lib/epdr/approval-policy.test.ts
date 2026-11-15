import { describe, expect, it } from "vitest";
import { validateApprovalSnapshot, type ApprovalContext, type ApprovalSnapshot } from "./approval-policy";

function snapshot(): ApprovalSnapshot {
  return {
    target: { siteId: 1, connectionId: 2, region: "jpn", accountId: "account", endpointId: 3, deviceId: "device", incidentId: 4, providerIncidentId: "incident", entityId: "entity" },
    actionType: "scan", parameters: { scanScope: 0, exclusions: ["approved-path"], options: { detect: true } },
    accountRevision: 1, credentialRevision: 2, ruleRevision: 3, evidenceGeneration: 4,
    requesterId: 5, expiresAt: 2000,
  };
}
function context(): ApprovalContext {
  return { nowMs: 1000, maxValidityMs: 1000, approverId: 6, approverIsCurrentSiteAdmin: true, requesterIsCurrentlyAuthorized: true, targetEligible: true, actionAllowed: true, capabilitySupported: true, connectionEnabled: true, dataFresh: true, killSwitch: false, hold: false };
}

describe("pure approval snapshot policy (not execution authorization)", () => {
  it("accepts a second current admin and exact snapshot, ignoring object key order only", () => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, { ...s, parameters: { options: { detect: true }, exclusions: ["approved-path"], scanScope: 0 } }, context())).toEqual({ eligible: true });
  });

  it("permits a system proposal only with current authorization checks", () => {
    const s = { ...snapshot(), requesterId: null };
    expect(validateApprovalSnapshot(s, s, context())).toEqual({ eligible: true });
    expect(validateApprovalSnapshot(s, s, { ...context(), requesterIsCurrentlyAuthorized: false }).eligible).toBe(false);
  });

  it.each(["siteId", "connectionId", "region", "accountId", "endpointId", "deviceId", "incidentId", "providerIncidentId", "entityId"] as const)("invalidates changed target %s", (key) => {
    const s = snapshot();
    const value = s.target[key];
    const current = { ...s, target: { ...s.target, [key]: typeof value === "number" ? value + 1 : `${value}-changed` } };
    expect(validateApprovalSnapshot(s, current, context())).toEqual({ eligible: false, reason: "snapshot_changed" });
  });

  it.each(["actionType", "parameters", "accountRevision", "credentialRevision", "ruleRevision", "evidenceGeneration", "requesterId", "expiresAt"] as const)("invalidates changed %s", (key) => {
    const s = snapshot();
    const changes = { actionType: "isolate", parameters: { ...s.parameters, exclusions: [] }, accountRevision: 2, credentialRevision: 3, ruleRevision: 4, evidenceGeneration: 5, requesterId: 7, expiresAt: 1999 };
    expect(validateApprovalSnapshot(s, { ...s, [key]: changes[key] }, context())).toEqual({ eligible: false, reason: "snapshot_changed" });
  });

  it("rejects self approval", () => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, s, { ...context(), approverId: 5 })).toEqual({ eligible: false, reason: "self_approval" });
  });

  it.each(["approverIsCurrentSiteAdmin", "requesterIsCurrentlyAuthorized", "targetEligible", "actionAllowed", "capabilitySupported", "connectionEnabled", "dataFresh"] as const)("rechecks %s at dispatch", (gate) => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, s, context()).eligible).toBe(true);
    expect(validateApprovalSnapshot(s, s, { ...context(), [gate]: false }).eligible).toBe(false);
  });

  it.each(["killSwitch", "hold"] as const)("does not bypass %s", (gate) => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, s, { ...context(), [gate]: true }).eligible).toBe(false);
  });

  it.each([2000, 2001, 0])("fails closed at expiry/current validity boundary %s", (nowMs) => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, s, { ...context(), nowMs })).toEqual({ eligible: false, reason: "expired" });
  });

  it("rechecks tightened maximum validity", () => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, s, { ...context(), maxValidityMs: 999 }).eligible).toBe(false);
  });

  it.each([
    null, {}, { ...snapshot(), extra: true }, { ...snapshot(), actionType: "unknown" },
    { ...snapshot(), accountRevision: -1 }, { ...snapshot(), expiresAt: "2000" },
    { ...snapshot(), requesterId: undefined }, { ...snapshot(), parameters: { option: undefined } },
    { ...snapshot(), parameters: { scope: NaN } }, { ...snapshot(), target: { ...snapshot().target, deviceId: " device" } },
  ])("rejects malformed snapshots without coercion %#", (bad) => {
    expect(validateApprovalSnapshot(bad, snapshot(), context())).toEqual({ eligible: false, reason: "invalid_input" });
    expect(validateApprovalSnapshot(snapshot(), bad, context()).eligible).toBe(false);
  });

  it.each([{}, { ...context(), nowMs: NaN }, { ...context(), targetEligible: undefined }, { ...context(), approverIsCurrentSiteAdmin: "true" }])("fails closed on missing/invalid current checks %#", (bad) => {
    const s = snapshot();
    expect(validateApprovalSnapshot(s, s, bad)).toEqual({ eligible: false, reason: "invalid_input" });
  });
});
