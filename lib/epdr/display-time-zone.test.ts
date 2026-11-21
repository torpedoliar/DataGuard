import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
import { loadEpdrDisplayTimeZone } from "./display-time-zone";

beforeEach(() => vi.resetAllMocks());
describe("EPDR display timezone resolution", () => {
  it("uses the personal preference before site scheduling", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ personal: "Asia/Jayapura", scheduling: "Asia/Jakarta" }] });
    expect(await loadEpdrDisplayTimeZone(4, 2)).toEqual({ personalTimeZone: "Asia/Jayapura", siteTimeZone: "Asia/Jakarta", timeZone: "Asia/Jayapura" });
    expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).params).toEqual([2, 4]);
  });
  it("inherits the explicit site zone when no personal preference exists", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ personal: null, scheduling: "Asia/Makassar" }] });
    expect((await loadEpdrDisplayTimeZone(4, 2)).timeZone).toBe("Asia/Makassar");
  });
  it("uses UTC for missing, invalid or unavailable preferences", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ personal: "bad", scheduling: null }] });
    expect((await loadEpdrDisplayTimeZone(4, 2)).timeZone).toBe("UTC");
    mocks.execute.mockRejectedValue(new Error("private diagnostic"));
    expect(await loadEpdrDisplayTimeZone(4, 2)).toEqual({ personalTimeZone: null, siteTimeZone: "UTC", timeZone: "UTC" });
  });
});
