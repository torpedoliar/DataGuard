import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), actor: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));
import { previewEpdrOperationalPlaybooks } from "./epdr-operational-playbooks";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 42, session: { userId: 7 } });
  mocks.actor.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((callback) => callback({ execute: mocks.execute }));
  mocks.execute.mockReset().mockResolvedValueOnce({ rows: [{ id: 9, account_revision: 3 }] }).mockResolvedValue({ rows: [] });
});
describe("operational stored preview", () => {
  it("requires active-site admin before database access", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "Unauthorized." });
    expect(await previewEpdrOperationalPlaybooks()).toEqual({ message: "Unauthorized." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("revalidates current actor transactionally and fails closed after revocation", async () => {
    mocks.actor.mockRejectedValue(new Error("revoked"));
    expect(await previewEpdrOperationalPlaybooks()).toEqual({ message: "Operational preview unavailable." });
    expect(mocks.actor).toHaveBeenCalledWith({ execute: mocks.execute }, 42, 7);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("requires a current enabled account binding", async () => {
    mocks.execute.mockReset().mockResolvedValue({ rows: [] });
    expect(await previewEpdrOperationalPlaybooks()).toHaveProperty("message");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("bounds a combined sample and exposes only source/id/template/result", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: Array.from({ length: 101 }, (_, id) => ({ source: "endpoint", id, observedAt: new Date(), identityKnown: true, protection: 2, raw: "private" })) });
    const result = await previewEpdrOperationalPlaybooks();
    if ("message" in result) throw new Error(result.message);
    expect(result).toMatchObject({ limit: 100, truncated: true });
    expect(result.rows).toHaveLength(100);
    expect(Object.keys(result.rows[0])).toEqual(["source", "id", "evaluations"]);
    expect(result.rows[0].evaluations[0].result.status).toBe("matched");
    expect(result.rows[0].evaluations[1].result.status).toBe("no_match");
    expect(JSON.stringify(result)).not.toContain("private");
    const dialect = new PgDialect();
    const binding = dialect.sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(binding.sql).toContain("FOR SHARE");
    expect(binding.params).toEqual([42]);
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[1][0]);
    for (const clause of ["c.site_id = e.site_id", "c.account_revision = e.account_revision", "e.site_id =", "c.account_revision =", "e.removed_at IS NULL", "c.enabled = true", "e.site_id = i.site_id", "e.id = i.epdr_endpoint_id", "i.site_id =", "c.last_test_at >= c.updated_at", "LIMIT 101"]) expect(query.sql).toContain(clause);
    expect(query.params).toEqual([42, 9, 3, 9, 42, 3, 42]);
    expect(query.sql).not.toMatch(/INSERT|UPDATE |DELETE|api_key|ro_password|raw/);
  });
  it("returns unknown and stale evidence as blocked rather than inventing healthy signals", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [
      { source: "endpoint", id: 1, observedAt: new Date(), identityKnown: true, protection: null },
      { source: "connection", id: 9, observedAt: null, identityKnown: true, testResult: null },
    ] });
    const result = await previewEpdrOperationalPlaybooks();
    if ("message" in result) throw new Error(result.message);
    expect(result.rows[0].evaluations[0].result).toMatchObject({ status: "blocked", reason: "unknown" });
    expect(result.rows[1].evaluations[5].result).toMatchObject({ status: "blocked", reason: "stale" });
  });
});
