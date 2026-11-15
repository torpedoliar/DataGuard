import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { epdrReadSyncRequests, watchguardConnections } from "@/db/schema";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: mocks }));
import { enqueueReadSync, processReadSyncQueue, readSyncStatus, cancelReadSync } from "./read-sync-queue";
const dialect = new PgDialect();
const queries = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute }));
});
describe("durable endpoint read queue (mock database only)", () => {
  it("declares matching composite connection/site integrity in schema and migration", () => {
    const config = getTableConfig(epdrReadSyncRequests);
    const fk = config.foreignKeys.find((key) => key.getName() === "epdr_read_sync_connection_site_fk")!;
    expect(fk.reference().columns.map((column) => column.name)).toEqual(["connection_id", "site_id"]);
    expect(fk.reference().foreignColumns.map((column) => column.name)).toEqual(["id", "site_id"]);
    expect(fk.onDelete).toBe("cascade");
    expect(getTableConfig(watchguardConnections).indexes.some((index) =>
      index.config.name === "watchguard_connections_id_site_idx" && index.config.unique)).toBe(true);
    const migration = readFileSync("drizzle/0072_epdr_read_sync_requests.sql", "utf8");
    expect(migration).toContain("UNIQUE INDEX watchguard_connections_id_site_idx ON watchguard_connections(id, site_id)");
    expect(migration).toContain("FOREIGN KEY (connection_id, site_id)");
    expect(migration).toContain("REFERENCES watchguard_connections(id, site_id) ON DELETE CASCADE");
  });
  it("locks the active-site binding before enqueue and persists its revision", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ role: "superadmin" }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] });
    await expect(enqueueReadSync(4, 9)).resolves.toEqual({ status: "queued", requestId: 42 });
    expect(queries()[0].sql).toContain("FOR UPDATE");
    expect(queries()[0].params).toContain(4);
    expect(queries()[4].params).toEqual([8, 4, 3, 9]);
    expect(queries()[3].sql).toContain("clock_timestamp()");
  });
  it("returns existing pending request rather than inserting", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ role: "superadmin" }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] });
    await expect(enqueueReadSync(4, 9)).resolves.toEqual({ status: "already_pending", requestId: 42 });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
  it("returns database-time cooldown without enqueue", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ role: "superadmin" }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ retry_at: "2026-01-01T12:00:00Z" }] });
    await expect(enqueueReadSync(4, 9)).resolves.toEqual({ status: "cooldown", retryAt: "2026-01-01T12:00:00.000Z" });
    expect(mocks.execute).toHaveBeenCalledTimes(4);
  });
  it.each(["inactive", "revoked"])("rejects %s request actors before enqueue", async (kind) => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: kind === "inactive" ? [] : [{ role: "staff" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(enqueueReadSync(4, 9)).rejects.toThrow(kind === "inactive" ? "read_sync_actor_unavailable" : "read_sync_membership_revoked");
    expect(queries().some((q) => q.sql.includes("INSERT INTO"))).toBe(false);
    if (kind === "revoked") expect(queries()[2].sql).toContain("FOR SHARE");
  });
  it("rejects disabled/missing binding", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(enqueueReadSync(4, 9)).resolves.toEqual({ status: "unavailable", reason: "connection_unavailable" });
  });
  it.each(["ok", "skipped_locked", "failed"])("fences final %s outcome, requeuing lock skips", async (outcome) => {
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [
      { id: 42, connection_id: 8, account_revision: 3, lease_token: "token" },
    ] }).mockResolvedValueOnce({ rows: [] });
    const run = vi.fn(async () => { if (outcome === "failed") throw new Error("private"); return outcome as "ok" | "skipped_locked"; });
    await processReadSyncQueue(run);
    expect(run).toHaveBeenCalledWith(8, { requestId: 42, leaseToken: "token" });
    expect(queries()[1].sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(queries()[1].sql).toContain("gen_random_uuid()");
    expect(queries()[2].sql).toContain("lease_until > clock_timestamp()");
    expect(queries()[2].params).toContain(outcome === "ok" ? "succeeded" : outcome === "skipped_locked" ? "queued" : "failed");
    expect(queries()[2].params).not.toContain("private");
  });
  afterEach(() => vi.useRealTimers());
  it("renews a long-running read and stops renewing after completion", async () => {
    vi.useFakeTimers();
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [
      { id: 42, connection_id: 8, account_revision: 3, lease_token: "token" },
    ] }).mockResolvedValue({ rows: [{ id: 42 }] });
    let finish!: (outcome: "ok") => void;
    const pending = processReadSyncQueue(() => new Promise((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(queries().filter((q) => q.sql.includes("RETURNING id"))).toHaveLength(2);
    const renewal = queries()[2];
    expect(renewal.sql).toContain("lease_until > clock_timestamp()");
    expect(renewal.sql).toContain("role_in_site = 'admin'");
    expect(renewal.params).toEqual([42, "token", 3, 8]);
    finish("ok");
    await pending;
    expect(queries().at(-1)?.params).toContain("succeeded");
    const calls = mocks.execute.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.execute).toHaveBeenCalledTimes(calls);
  });
  it.each(["revoked", "database_error"])("invalidates the publication fence on renewal %s", async (reason) => {
    vi.useFakeTimers();
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [
      { id: 42, connection_id: 8, account_revision: 3, lease_token: "token" },
    ] });
    if (reason === "database_error") mocks.execute.mockRejectedValueOnce(new Error("private"));
    else mocks.execute.mockResolvedValueOnce({ rows: [] });
    let finish!: (outcome: "ok") => void;
    let publicationFence: { requestId: number; leaseToken: string } | undefined;
    const pending = processReadSyncQueue((_id, fence) => {
      publicationFence = fence;
      return new Promise((resolve) => { finish = resolve; });
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publicationFence?.leaseToken).toBe("");
    finish("ok");
    await pending;
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(queries().some((q) => q.params.includes("succeeded"))).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
  it("returns idle rather than inventing a completed run", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    expect((await readSyncStatus(4)).status).toBe("idle");
  });
  it("cancels using connection-first lock order and invalidates fencing token", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await cancelReadSync(4);
    expect(queries()[0].sql).toContain("watchguard_connections");
    expect(queries()[1].sql).toContain("lease_token = NULL");
  });
});
