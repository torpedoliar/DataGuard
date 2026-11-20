import { describe, expect, it } from "vitest";
import { evaluateExecutionPolicy, type ExecutionPolicyInput } from "./execution-policy";
import type { ExecutionSnapshot } from "./execution-request";

function snapshot(overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return {
    siteId: 1,
    connectionId: 2,
    region: "jpn",
    accountId: "acct",
    target: { endpointId: 10, deviceId: "dev-1", entityId: null, providerIncidentId: null },
    namespace: "endpoint_security",
    actionType: "scan",
    parameters: {},
    accountRevision: 3,
    credentialRevision: 4,
    evidenceGeneration: 5,
    requesterId: 7,
    expiresAt: 2_000_000_000_000,
    ...overrides,
  };
}

function input(overrides: Partial<ExecutionPolicyInput> = {}): ExecutionPolicyInput {
  const snap = snapshot();
  return {
    stage: "request",
    nowMs: 1_800_000_000_000,
    writeEnabled: true,
    globalKillSwitch: false,
    siteKillSwitch: false,
    automationPaused: false,
    allowedActions: ["scan", "isolate", "unisolate", "reboot", "assign_config"],
    siteAllowedActions: ["scan", "isolate", "unisolate", "reboot", "assign_config"],
    connectionEnabled: true,
    writeCredentialsPresent: true,
    currentAccountRevision: 3,
    currentCredentialRevision: 4,
    currentEvidenceGeneration: 5,
    endpointPresent: true,
    endpointRemoved: false,
    endpointHold: false,
    exclusionActive: false,
    dataFresh: true,
    cooldownActive: false,
    actionsLastHour: 0,
    maxActionsPerHour: 30,
    snapshot: snap,
    requesterId: 7,
    requesterIsCurrentlyAuthorized: true,
    ...overrides,
  };
}

describe("execution policy — fail closed", () => {
  it("allows a well-formed request only when write is explicitly enabled", () => {
    expect(evaluateExecutionPolicy(input()).allowed).toBe(true);
    expect(evaluateExecutionPolicy(input({ writeEnabled: false }))).toEqual({
      allowed: false,
      reason: "write_not_enabled",
    });
  });

  it.each([
    ["globalKillSwitch", true, "global_kill_switch"],
    ["siteKillSwitch", true, "site_kill_switch"],
    ["connectionEnabled", false, "connection_disabled"],
    ["writeCredentialsPresent", false, "write_credentials_missing"],
    ["endpointPresent", false, "endpoint_missing"],
    ["endpointRemoved", true, "endpoint_removed"],
    ["endpointHold", true, "endpoint_hold"],
    ["exclusionActive", true, "exclusion_active"],
    ["dataFresh", false, "data_stale"],
    ["cooldownActive", true, "cooldown_active"],
  ] as const)("blocks when %s is %s", (key, value, reason) => {
    expect(evaluateExecutionPolicy(input({ [key]: value } as Partial<ExecutionPolicyInput>))).toEqual({
      allowed: false,
      reason,
    });
  });

  it("blocks an action outside the global ceiling or the site narrowing", () => {
    expect(evaluateExecutionPolicy(input({ allowedActions: ["isolate"] }))).toEqual({
      allowed: false,
      reason: "action_not_allowed",
    });
    expect(evaluateExecutionPolicy(input({ siteAllowedActions: [] }))).toEqual({
      allowed: false,
      reason: "action_not_allowed",
    });
  });

  it("blocks when the account, credential, or evidence revision moved", () => {
    expect(evaluateExecutionPolicy(input({ currentAccountRevision: 99 }))).toEqual({
      allowed: false,
      reason: "snapshot_changed",
    });
    expect(evaluateExecutionPolicy(input({ currentCredentialRevision: 99 }))).toEqual({
      allowed: false,
      reason: "snapshot_changed",
    });
    expect(evaluateExecutionPolicy(input({ currentEvidenceGeneration: 99 }))).toEqual({
      allowed: false,
      reason: "snapshot_changed",
    });
  });

  it("rate limits per site", () => {
    expect(evaluateExecutionPolicy(input({ actionsLastHour: 30 }))).toEqual({
      allowed: false,
      reason: "rate_limited",
    });
  });

  it("rejects an unverified operation and an invalid snapshot", () => {
    expect(evaluateExecutionPolicy(input({ snapshot: { ...snapshot(), actionType: "uninstall" } }))).toEqual({
      allowed: false,
      reason: "snapshot_invalid",
    });
    expect(evaluateExecutionPolicy(input({ snapshot: null }))).toEqual({
      allowed: false,
      reason: "snapshot_invalid",
    });
  });

  it("does not let a client-supplied flag bypass a block", () => {
    const decision = evaluateExecutionPolicy({
      ...input({ globalKillSwitch: true }),
      approved: true,
      allowWrites: true,
    } as ExecutionPolicyInput);
    expect(decision).toEqual({ allowed: false, reason: "global_kill_switch" });
  });
});

describe("execution policy — approval", () => {
  const approval = { approverId: 9, approverIsCurrentSiteAdmin: true, expiresAt: 1_900_000_000_000 };
  const current = { currentSnapshot: snapshot() };

  it.each(["approve", "dispatch"] as const)("allows self approval at %s for a current site admin", (stage) => {
    const decision = evaluateExecutionPolicy(input({ stage, ...current, approval: { ...approval, approverId: 7 } }));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["approve", "dispatch"] as const)("still requires current authorization for self approval at %s", (stage) => {
    const selfApproval = { ...approval, approverId: 7 };
    expect(evaluateExecutionPolicy(input({
      stage, ...current, approval: { ...selfApproval, approverIsCurrentSiteAdmin: false },
    }))).toEqual({ allowed: false, reason: "approver_not_admin" });
    expect(evaluateExecutionPolicy(input({
      stage, ...current, approval: selfApproval, requesterIsCurrentlyAuthorized: false,
    }))).toEqual({ allowed: false, reason: "requester_not_authorized" });
  });

  it("requires a currently authorized requester", () => {
    expect(
      evaluateExecutionPolicy(input({ stage: "approve", ...current, approval, requesterIsCurrentlyAuthorized: false })),
    ).toEqual({ allowed: false, reason: "requester_not_authorized" });
  });

  it("requires an actual approval decision", () => {
    expect(evaluateExecutionPolicy(input({ stage: "approve", ...current }))).toEqual({
      allowed: false,
      reason: "approval_missing",
    });
  });

  it("rejects a stale approver and an expired approval window", () => {
    expect(
      evaluateExecutionPolicy(input({
        stage: "approve",
        ...current,
        approval: { ...approval, approverIsCurrentSiteAdmin: false },
      })),
    ).toEqual({ allowed: false, reason: "approver_not_admin" });
    expect(
      evaluateExecutionPolicy(input({
        stage: "approve",
        ...current,
        approval: { ...approval, expiresAt: 1_700_000_000_000 },
      })),
    ).toEqual({ allowed: false, reason: "approval_expired" });
    expect(
      evaluateExecutionPolicy(input({
        stage: "approve",
        approval,
        snapshot: snapshot({ expiresAt: 1_700_000_000_000 }),
        currentSnapshot: snapshot({ expiresAt: 1_700_000_000_000 }),
      })),
    ).toEqual({ allowed: false, reason: "approval_expired" });
  });

  it("blocks approval after the target changed", () => {
    expect(
      evaluateExecutionPolicy(input({
        stage: "approve",
        approval,
        currentSnapshot: snapshot({ target: { endpointId: 10, deviceId: "dev-2", entityId: null, providerIncidentId: null } }),
      })),
    ).toEqual({ allowed: false, reason: "snapshot_changed" });
  });

  it("blocks approval while automation is paused", () => {
    expect(
      evaluateExecutionPolicy(input({ stage: "approve", ...current, approval, automationPaused: true })),
    ).toEqual({ allowed: false, reason: "automation_paused" });
  });

  it("allows a different administrator on an eligible request", () => {
    expect(evaluateExecutionPolicy(input({ stage: "approve", ...current, approval })).allowed).toBe(true);
  });
});

describe("execution policy — dispatch", () => {
  const approval = { approverId: 9, approverIsCurrentSiteAdmin: true, expiresAt: 1_900_000_000_000 };

  it("requires an approval", () => {
    expect(evaluateExecutionPolicy(input({ stage: "dispatch", currentSnapshot: snapshot() }))).toEqual({
      allowed: false,
      reason: "approval_missing",
    });
  });

  it("blocks an expired approval and an expired snapshot window", () => {
    expect(
      evaluateExecutionPolicy(input({
        stage: "dispatch",
        approval: { ...approval, expiresAt: 1_700_000_000_000 },
        currentSnapshot: snapshot(),
      })),
    ).toEqual({ allowed: false, reason: "approval_expired" });

    expect(
      evaluateExecutionPolicy(input({
        stage: "dispatch",
        approval,
        snapshot: snapshot({ expiresAt: 1_700_000_000_000 }),
        currentSnapshot: snapshot({ expiresAt: 1_700_000_000_000 }),
      })),
    ).toEqual({ allowed: false, reason: "approval_expired" });
  });

  it("blocks when the re-derived snapshot differs in any material field", () => {
    expect(
      evaluateExecutionPolicy(input({
        stage: "dispatch",
        approval,
        currentSnapshot: snapshot({ parameters: { scan_scope: 2 } }),
      })),
    ).toEqual({ allowed: false, reason: "snapshot_changed" });
  });

  it("blocks a terminal request and a stale approver", () => {
    expect(
      evaluateExecutionPolicy(input({ stage: "dispatch", approval, currentSnapshot: snapshot(), terminal: true })),
    ).toEqual({ allowed: false, reason: "already_terminal" });
    expect(
      evaluateExecutionPolicy(input({
        stage: "dispatch",
        approval: { ...approval, approverIsCurrentSiteAdmin: false },
        currentSnapshot: snapshot(),
      })),
    ).toEqual({ allowed: false, reason: "approver_not_admin" });
  });

  it("allows a fully consistent dispatch and returns the snapshot hash", () => {
    const decision = evaluateExecutionPolicy(input({ stage: "dispatch", approval, currentSnapshot: snapshot() }));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
