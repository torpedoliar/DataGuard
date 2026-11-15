import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), actor: vi.fn(), transaction: vi.fn(), execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));
import { getEpdrOperations } from "./epdr-operations";
const tx = { execute: mocks.execute };
const dialect = new PgDialect();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
  mocks.transaction.mockImplementation((callback: (value: typeof tx) => unknown) => callback(tx));
  mocks.execute.mockResolvedValue({ rows: [] });
});

describe("EPDR local operations ledger", () => {
  it.each(["unauthenticated", "not admin", "no active site"])("denies %s before DB access", async (message) => {
    mocks.guard.mockResolvedValue({ ok: false, message });
    expect(await getEpdrOperations()).toEqual({ message });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([null, [], { siteId: 999 }, { limit: 500 }, { view: "dispatch" }, { page: 0 }, { page: -1 }, { page: 1.5 }, { page: Infinity }, { page: 10001 }, { page: "2" }])("rejects invalid request %j", async (input) => {
    expect(await getEpdrOperations(input)).toEqual({ message: "Invalid ledger request." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("revalidates current site-admin access inside the transaction before reading", async () => {
    mocks.actor.mockRejectedValue(new Error("revoked secret"));
    expect(await getEpdrOperations()).toEqual({ message: "Operations unavailable. Check access and required migrations." });
    expect(mocks.actor).toHaveBeenCalledWith(tx, 17, 9);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("uses the same scoped union for count and page, with stable sorting and a bounded offset", async () => {
    await getEpdrOperations({ view: "activity", page: 3 });
    expect(mocks.actor.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual([17, 17, 17, 17, 17, 17, 17, 17, 100]);
    for (const table of ["epdr_actions", "epdr_rule_evaluations", "epdr_incident_handoffs", "epdr_playbook_runs", "epdr_read_sync_requests", "epdr_local_playbook_runs", "epdr_local_notification_outbox", "epdr_local_approvals"]) {
      expect(query.sql).toMatch(new RegExp(`FROM ${table} WHERE site_id = \\$\\d+`));
    }
    expect(query.sql).toContain("count(*) AS total FROM ledger");
    expect(query.sql).toContain("FROM ledger");
    expect(query.sql).toContain("ORDER BY created_at DESC NULLS LAST, kind ASC, id DESC LIMIT 50 OFFSET");
    expect(query.sql).toContain("LEFT JOIN page_rows ON true");
    expect(query.sql).not.toMatch(/SELECT\s+\*|\b(params|raw|evidence|note|error|result|provider_ref|request|response)\b/i);
    expect(query.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("approvals only includes local approval intentions and unlinked evaluations, never local history", async () => {
    await getEpdrOperations({ view: "approvals" });
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual([17, 17, 0]);
    expect(query.sql).toContain("mode = 'approval' OR state = 'pending_approval'");
    expect(query.sql).toContain("effective_mode = 'approval' AND action_id IS NULL");
    expect(query.sql).not.toMatch(/epdr_(playbook_runs|incident_handoffs|read_sync_requests)/);
  });

  it("projects only safe fields and maps unknown free text to fixed enums", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: 5, kind: "action", state: "token=private", action_type: "secret command", created_at: new Date("2026-01-01Z"), total: "1", params: { token: "private" }, error: "secret", raw: "payload" }] });
    expect(await getEpdrOperations()).toEqual({ view: "activity", page: 1, limit: 50, total: 1, providerLocked: true,
      rows: [{ id: 5, kind: "action", status: "unknown", action: "other", createdAt: "2026-01-01T00:00:00.000Z" }] });
  });

  it.each([
    ["localRun", "finished", "recorded"], ["localRun", "pending", "pending"],
    ["readSync", "partial", "partial"], ["notification", "delivered", "succeeded"],
    ["approval", "approved", "recorded"], ["approval", "rejected", "cancelled"], ["approval", "expired", "expired"],
  ])("reports %s %s truthfully as %s", async (kind, state, expected) => {
    mocks.execute.mockResolvedValue({ rows: [{ id: 5, kind, state, action_type: null, created_at: null, total: "1" }] });
    expect(await getEpdrOperations()).toMatchObject({ rows: [{ kind, status: expected }] });
  });
  it("retains totals for an empty out-of-range page without manufacturing a row", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: null, kind: null, state: null, action_type: null, created_at: null, total: "12" }] });
    expect(await getEpdrOperations({ page: 4 })).toMatchObject({ page: 4, total: 12, rows: [] });
  });

  it("hides database failures", async () => {
    mocks.execute.mockRejectedValue(new Error("password secret"));
    expect(await getEpdrOperations()).toEqual({ message: "Operations unavailable. Check access and required migrations." });
  });
});
