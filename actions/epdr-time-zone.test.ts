import { beforeEach, describe, expect, it, vi } from "vitest";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAction: mocks.guard }));
import { getEpdrTimeZone, setEpdrTimeZone } from "./epdr-time-zone";
const compile = (query: SQL) => new PgDialect().sqlToQuery(query);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 2, session: { userId: 4 } });
  mocks.execute.mockResolvedValue({ rows: [{ epdr_time_zone: null }] });
});
describe("personal timezone actions", () => {
  it("reads the current user's nullable preference", async () => {
    expect(await getEpdrTimeZone()).toEqual({ timeZone: null });
    expect(compile(mocks.execute.mock.calls[0][0]).params).toEqual([4]);
  });
  it.each([null, "UTC", "Asia/Jakarta", "America/New_York"])("stores only the current user's preference %s", async (zone) => {
    mocks.execute.mockResolvedValue({ rows: [{ epdr_time_zone: zone }] });
    expect(await setEpdrTimeZone(zone)).toEqual({ timeZone: zone });
    const query = compile(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual([zone, 4]);
    expect(query.sql).not.toContain("notification_policies");
  });
  it.each([undefined, "WIB", " UTC", "Invalid/Zone", { timeZone: "UTC", userId: 9 }])("rejects invalid input %s", async (zone) => {
    expect(await setEpdrTimeZone(zone)).toHaveProperty("message");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated reads and writes before storage", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "Denied" });
    expect(await getEpdrTimeZone()).toEqual({ message: "Denied" });
    expect(await setEpdrTimeZone("UTC")).toEqual({ message: "Denied" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("fails closed for inactive/deleted users and does not expose database errors", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    expect(await setEpdrTimeZone(null)).toHaveProperty("message");
    mocks.execute.mockRejectedValue(new Error("private"));
    expect(await getEpdrTimeZone()).toEqual({ message: "Timezone preference unavailable." });
  });
});
