import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), actor: vi.fn(), execute: vi.fn(), transaction: vi.fn(), audit: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));

vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { decideEpdrLocalApproval, getEpdrLocalApprovals, requestEpdrLocalApproval } from "./epdr-local-approvals";

const dialect = new PgDialect();
const queries = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
const evidence = {
  providerLocked: true,
  definition: { template: { id: "malware-virus", steps: ["review", "incident", "scan"] } },
  responsePolicy: { status: "proposed", route: "operator_incident_pic_review" },
};
const run = { id: 7, status: "finished", evidence, detection_id: 31 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
  mocks.actor.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback) => callback({ execute: mocks.execute }));
  mocks.execute.mockResolvedValue({ rows: [] });
});

function requestRows({ existing = false, evidenceValue = evidence }: { existing?: boolean; evidenceValue?: unknown } = {}) {
  mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] })
    .mockResolvedValueOnce({ rows: [{ ...run, evidence: evidenceValue }] })
    .mockResolvedValueOnce({ rows: [{ id: 5 }] })
    .mockResolvedValueOnce({ rows: existing ? [{ id: 11 }] : [] })
    .mockResolvedValueOnce({ rows: [{ id: 11 }] });
}

describe("durable local approvals", () => {
  it("denies every action before database access", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "Forbidden" });
    expect(await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true })).toEqual({ message: "Forbidden" });
    expect(await decideEpdrLocalApproval({ approvalId: 11, decision: "approve" })).toEqual({ message: "Forbidden" });
    expect(await getEpdrLocalApprovals()).toEqual({ message: "Forbidden" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { runId: 7, actionIntent: "scan" }, { runId: 7, actionIntent: "scan", confirmLocalApproval: false },
    { runId: 7, actionIntent: "reboot", confirmLocalApproval: true }, { runId: 7, actionIntent: "scan", confirmLocalApproval: true, siteId: 99 },
  ])("rejects invalid request %j before database access", async (input) => {
    expect(await requestEpdrLocalApproval(input)).toHaveProperty("message");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("records an immutable local snapshot for a proposed provider intention", async () => {
    requestRows();
    expect(await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true })).toEqual({ approvalId: 11, existing: false });
    const insert = queries().find((query) => query.sql.includes("INSERT INTO epdr_local_approvals"))!;
    const snapshot = JSON.parse(insert.params.find((value) => typeof value === "string" && value.startsWith("{")) as string);
    expect(snapshot).toMatchObject({
      schemaVersion: 1, actionIntent: "scan", templateId: "malware-virus",
      localRunId: 7, detectionId: 31, endpointId: 5, connectionId: 2, accountRevision: 3, providerLocked: true,
    });
    expect(snapshot).not.toHaveProperty("raw");
    expect(insert.params.slice(0, 7)).toEqual([17, 31, 7, 5, 2, 3, "scan"]);
    expect(insert.sql).toContain("interval '24 hours'");
    expect(queries().some((query) => /INSERT INTO (incidents|epdr_local_notifications)|UPDATE epdr_detections/.test(query.sql))).toBe(false);
  });

  it("resolves legacy runs through the current scoped detection, not a nonexistent run column", async () => {
    requestRows();
    await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true });
    expect(queries()[1].sql).not.toContain("endpoint_id");
    const endpoint = queries()[2];
    expect(endpoint.sql).toContain("e.id = d.endpoint_id");
    expect(endpoint.sql).toContain("e.site_id = d.site_id");
    expect(endpoint.sql).toContain("e.connection_id = d.connection_id");
    expect(endpoint.sql).toContain("e.account_revision = d.account_revision");
    expect(endpoint.sql).toContain("FOR SHARE OF d, e");
    expect(endpoint.params).toEqual([31, 17, 2, 3, null, null]);
  });

  it("requires a captured endpoint to still match rather than silently retargeting", async () => {
    requestRows({ evidenceValue: { ...evidence, endpointId: 6 } });
    await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true });
    expect(queries()[2].params).toEqual([31, 17, 2, 3, 6, 6]);
    expect(queries()[2].sql).toContain("OR e.id =");
  });

  it.each([null, 0, -1, "5", 1.5])("rejects malformed captured endpoint %j", async (endpointId) => {
    requestRows({ evidenceValue: { ...evidence, endpointId } });
    expect(await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true })).toHaveProperty("message");
    expect(queries()).toHaveLength(2);
  });

  it("returns an existing approval without appending a duplicate", async () => {
    requestRows({ existing: true });
    expect(await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true })).toEqual({ approvalId: 11, existing: true });
    expect(queries().some((query) => query.sql.includes("INSERT INTO epdr_local_approvals"))).toBe(false);
  });

  it.each([
    ["blocked policy", { ...evidence, responsePolicy: { status: "blocked", route: null } }],
    ["missing policy route", { ...evidence, responsePolicy: { status: "proposed", route: null } }],
    ["intent absent from template", { ...evidence, definition: { template: { id: "ioa", steps: ["review", "handoff"] } } }],
    ["provider not locked", { ...evidence, providerLocked: false }],
    ["unknown evidence shape", null],
  ])("fails closed for %s", async (_label, evidenceValue) => {
    requestRows({ evidenceValue });
    expect(await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true })).toHaveProperty("message");
    expect(queries().some((query) => query.sql.includes("INSERT INTO epdr_local_approvals"))).toBe(false);
  });

  it("rejects an endpoint absent from the current binding revision", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [run] }).mockResolvedValueOnce({ rows: [] });
    expect(await requestEpdrLocalApproval({ runId: 7, actionIntent: "scan", confirmLocalApproval: true })).toHaveProperty("message");
    expect(queries()[2].sql).toContain("removed_at IS NULL");
    expect(queries().some((query) => query.sql.includes("INSERT INTO epdr_local_approvals"))).toBe(false);
  });

  it("approves locally with a blocked_read_only decision and no dispatch", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, requested_by: 9, status: "pending", expires_at: new Date(Date.now() + 60_000), account_revision: 3, connection_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });
    expect(await decideEpdrLocalApproval({ approvalId: 11, decision: "approve", note: "checked" })).toEqual({
      approvalId: 11, status: "approved", providerExecution: "blocked_read_only",
    });
    const update = queries().find((query) => query.sql.includes("UPDATE epdr_local_approvals"))!;
    const record = JSON.parse(update.params.find((value) => typeof value === "string" && value.startsWith("{")) as string);
    expect(record).toEqual({ schemaVersion: 1, decision: "approved", providerExecution: "blocked_read_only", reason: "read_only_lock" });
    expect(update.sql).toContain("status = 'pending'");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entity: "epdr_local_approval", detail: expect.stringContaining('"selfApproved":true') }));
  });

  it("rejects locally without any provider side effect", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, requested_by: 8, status: "pending", expires_at: new Date(Date.now() + 60_000), account_revision: 3, connection_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });
    expect(await decideEpdrLocalApproval({ approvalId: 11, decision: "reject" })).toMatchObject({ status: "rejected" });
    expect(queries().some((query) => /UPDATE (epdr_actions|incidents)|INSERT INTO epdr_/i.test(query.sql))).toBe(false);
  });

  it("refuses an expired row or a changed account revision", async () => {
    const row = { id: 11, requested_by: 8, status: "pending", expires_at: new Date(Date.now() + 60_000), account_revision: 3, connection_id: 2 };
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] }).mockResolvedValueOnce({ rows: [{ ...row, expires_at: new Date(Date.now() - 1_000) }] });
    expect(await decideEpdrLocalApproval({ approvalId: 11, decision: "approve" })).toEqual({ message: "Approval expired." });
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 4 }] }).mockResolvedValueOnce({ rows: [row] });
    expect(await decideEpdrLocalApproval({ approvalId: 11, decision: "approve" })).toHaveProperty("message");
    expect(queries().some((query) => query.sql.includes("UPDATE epdr_local_approvals"))).toBe(false);
  });

  it("lists bounded decisions and evaluates expiry on read", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [
      { id: 11, local_run_id: 7, detection_id: 31, endpoint_id: 5, action_intent: "scan", status: "pending",
        requested_by: 9, decided_by: null, decided_at: null, decision_note: null,
        expires_at: new Date(0), created_at: new Date(1), expired: true },
      { id: 12, local_run_id: 8, detection_id: 32, endpoint_id: 6, action_intent: "isolate", status: "approved",
        requested_by: 9, decided_by: 8, decided_at: new Date(2), decision_note: "ok",
        expires_at: new Date(Date.now() + 60_000), created_at: new Date(1), expired: false },
    ] }).mockResolvedValueOnce({ rows: [{ total: 2, pending: 0 }] });
    const result = await getEpdrLocalApprovals();
    expect(result).toMatchObject({ limit: 50, total: 2, pending: 0, rows: [{ status: "expired" }, { status: "approved" }] });
  });
});
