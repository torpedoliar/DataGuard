import { describe, expect, it, vi } from "vitest";
import { nextState, type ActionEvent, type EpdrActionState } from "./actions";
import { validateApprovalSnapshot, type ApprovalContext, type ApprovalSnapshot } from "./approval-policy";
import { buildScanPayload } from "./dispatcher";
import { classifyScanStatus, decideAdoption, isCleanScan } from "./task-tracker";
import { createWatchGuardClient } from "../watchguard/client";

// Test-only in-memory orchestration, NOT a durable approval/dispatcher adapter.
const frozen: ApprovalSnapshot = {
  target: { siteId: 1, connectionId: 2, region: "jpn", accountId: "account", endpointId: 3, deviceId: "device", incidentId: 4, providerIncidentId: null, entityId: null },
  actionType: "scan", parameters: { scanScope: 0, windowHours: 24 },
  accountRevision: 1, credentialRevision: 1, ruleRevision: 1, evidenceGeneration: 1,
  requesterId: 5, expiresAt: 2000,
};
const checks: ApprovalContext = {
  nowMs: 1000, maxValidityMs: 1000, approverId: 6, approverIsCurrentSiteAdmin: true,
  requesterIsCurrentlyAuthorized: true, targetEligible: true, actionAllowed: true,
  capabilitySupported: true, connectionEnabled: true, dataFresh: true, killSwitch: false, hold: false,
};
const marker = "dc-check action:mock-unique-action-1 incident:4";
const payload = buildScanPayload({ deviceIds: [frozen.target.deviceId], taskName: marker, scanScope: 0, windowHours: 24 });
type Task = { name: string; accountId: string; accountRevision: number; recipients: string[]; scope: number; startedAt: number };
const exact: Task = { name: marker, accountId: "account", accountRevision: 1, recipients: ["device"], scope: 0, startedAt: 1100 };

function flow() {
  let state: EpdrActionState = "pending_approval";
  function transition(event: ActionEvent) {
    const next = nextState(state, event);
    if (next === null) return false;
    state = next;
    return true;
  }
  const send = vi.fn(async () => { throw new Error("mock response lost after acceptance"); });
  return {
    state: () => state,
    transition,
    send,
    async dispatch(current = frozen, context = checks) {
      // Revalidate before mock claim; validation is not an approve bypass.
      if (!validateApprovalSnapshot(frozen, current, context).eligible || !transition("claim")) return;
      try { await send(); } catch { transition("timeout"); }
    },
    reconcile(tasks: Task[]) {
      const matches = tasks.filter((t) => t.name === marker && t.accountId === frozen.target.accountId &&
        t.accountRevision === frozen.accountRevision && t.recipients.length === 1 && t.recipients[0] === frozen.target.deviceId &&
        t.scope === frozen.parameters.scanScope && t.startedAt >= 1000 && t.startedAt <= 1200);
      transition(decideAdoption(matches.length) === "adopt" ? "reconcile_match" : "reconcile_ambiguous");
    },
  };
}

describe("mock-only approval → ambiguous dispatch → reconciliation", () => {
  it("adopts exactly one intended task and completes execution without resending or claiming remediation", async () => {
    const f = flow();
    expect(validateApprovalSnapshot(frozen, frozen, checks)).toEqual({ eligible: true });
    expect(f.transition("approve")).toBe(true);
    expect(f.transition("approve")).toBe(false);
    expect(payload).toMatchObject({ task_name: marker, device_ids: ["device"], execution_window_expiration: "1.00:00:00" });
    await f.dispatch();
    expect(f.state()).toBe("outcome_unknown");
    await f.dispatch();
    expect(f.send).toHaveBeenCalledTimes(1);
    f.reconcile([exact]);
    expect(f.state()).toBe("in_progress");
    expect(classifyScanStatus(1)).toBe("pending");
    expect(classifyScanStatus(2)).toBe("succeeded");
    expect(f.transition("task_completed")).toBe(true);
    expect(f.state()).toBe("completed");
    // Execution completion is NOT clean evidence, verification or incident closure.
    expect(isCleanScan(classifyScanStatus(2), false)).toBe(false);
    expect(f.transition("claim")).toBe(false);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [], [exact, { ...exact }], [{ ...exact, name: `${marker}-other` }],
    [{ ...exact, accountId: "other" }], [{ ...exact, accountRevision: 2 }],
    [{ ...exact, recipients: ["other"] }], [{ ...exact, recipients: ["device", "other"] }],
    [{ ...exact, scope: 1 }], [{ ...exact, startedAt: 999 }], [{ ...exact, startedAt: 1201 }],
  ].map((tasks) => ({ tasks })))("reviews missing, duplicate, or mismatched reconciliation candidates %# without another send", async ({ tasks }) => {
    const f = flow();
    f.transition("approve");
    await f.dispatch();
    f.reconcile(tasks);
    expect(f.state()).toBe("needs_review");
    await f.dispatch();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("rechecks current approval gates before dispatch and never claims blocked work", async () => {
    const f = flow();
    f.transition("approve");
    await f.dispatch(frozen, { ...checks, approverIsCurrentSiteAdmin: false });
    await f.dispatch({ ...frozen, accountRevision: 2 });
    await f.dispatch(frozen, { ...checks, nowMs: 2000 });
    await f.dispatch(frozen, { ...checks, targetEligible: false });
    await f.dispatch(frozen, { ...checks, killSwitch: true });
    expect(f.state()).toBe("queued"); // only an in-memory test state
    expect(f.send).not.toHaveBeenCalled();
  });

  it("cannot revive rejected or cancelled requests", async () => {
    const f = flow();
    f.transition("reject");
    expect(f.transition("approve")).toBe(false);
    await f.dispatch();
    expect(f.state()).toBe("cancelled");
    expect(f.send).not.toHaveBeenCalled();
  });

  it("blocks the same approved payload through the real client before any network or acceptance", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createWatchGuardClient({ region: "jpn", accountId: "account", accessId: "mock-access", password: "mock-password", apiKey: "mock-key" }, { fetch });
    expect(validateApprovalSnapshot(frozen, frozen, checks).eligible).toBe(true);
    await expect(client.startImmediateScan(payload)).rejects.toMatchObject({ kind: "read_only_blocked", outcomeUnknown: false });
    expect(fetch).not.toHaveBeenCalled();
    // No production flow was created, claimed, accepted or queued by validation.
    expect(frozen).not.toHaveProperty("state");
    expect(frozen).not.toHaveProperty("providerRef");
  });
});
