import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), settings: vi.fn(), transaction: vi.fn(), execute: vi.fn(), audit: vi.fn(), actor: vi.fn(), binding: vi.fn(), credentials: vi.fn(), endpoint: vi.fn(), build: vi.fn(), authorized: vi.fn(), recent: vi.fn(), cooldown: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/epdr/execution-store", () => ({
  loadExecutionSettings: mocks.settings,
  loadConnectionBinding: mocks.binding,
  hasWriteCredentials: mocks.credentials,
  countRecentDispatches: mocks.recent,
  countRecentRequests: vi.fn(),
  hasRecentDispatch: mocks.cooldown,
  isActiveSiteAdmin: mocks.authorized,
  loadEndpointExecutionState: mocks.endpoint,
}));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));
vi.mock("@/lib/epdr/execution-snapshot", () => ({ buildExecutionSnapshot: mocks.build }));
import { executionSnapshotHash } from "@/lib/epdr/execution-request";
import { approveEpdrExecutionRequest, getEpdrExecutionOptions } from "./epdr-executions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
});
afterEach(() => vi.restoreAllMocks());

describe("execution options failure diagnostics", () => {
  it.each([
    { failure: new Error("private SQL and credentials", { cause: Object.assign(new Error("private driver details"), { code: "42703" }) }), description: "sqlstate=42703" },
    { failure: new Error("private provider payload"), description: "error=unknown" },
  ])("keeps client errors generic and logs only $description", async ({ failure, description }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.settings.mockRejectedValue(failure);
    expect(await getEpdrExecutionOptions()).toEqual({ code: "service_unavailable" });
    expect(log).toHaveBeenCalledExactlyOnceWith(`[epdr-executions] options failed (${description})`);
  });
});


describe("execution approval audit", () => {
  it.each([9, 8])("allows requester %s and records who approved", async (requesterId) => {
    const snapshot = {
      siteId: 17, connectionId: 2, region: "jpn", accountId: "acct",
      target: { endpointId: 10, deviceId: "dev-1", entityId: null, providerIncidentId: null },
      namespace: "endpoint_security" as const, actionType: "scan" as const, parameters: {},
      accountRevision: 3, credentialRevision: 4, evidenceGeneration: 5,
      requesterId, expiresAt: Date.now() + 60_000,
    };
    mocks.transaction.mockImplementation((run) => run({ execute: mocks.execute }));
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 11, state: "pending_approval", action_type: "scan", endpoint_id: 10,
      requested_by: requesterId, approved_by: null, snapshot, snapshot_hash: executionSnapshotHash(snapshot) }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    mocks.settings.mockResolvedValue({ globalWritesEnabled: true, siteWritesEnabled: true,
      globalAllowedActions: ["scan"], siteAllowedActions: ["scan"], maxActionsPerHour: 30, approvalExpiryMinutes: 10 });
    mocks.binding.mockResolvedValue({ enabled: true, connectionId: 2, accountRevision: 3, credentialRevision: 4 });
    mocks.endpoint.mockResolvedValue({ endpointPresent: true, evidenceGeneration: 5, dataFresh: true });
    mocks.credentials.mockResolvedValue(true); mocks.authorized.mockResolvedValue(true);
    mocks.recent.mockResolvedValue(0); mocks.cooldown.mockResolvedValue(false);
    mocks.build.mockResolvedValue({ ok: true, snapshot });
    expect(await approveEpdrExecutionRequest({ requestId: 11, confirmApproval: true })).toEqual({ state: "queued" });
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.audit.mock.calls[0][0].detail)).toMatchObject({
      event: "approve", requestedBy: requesterId, approvedBy: 9, selfApproved: requesterId === 9,
    });
  });
});
