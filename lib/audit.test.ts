import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// getAuditLogs calls verifySession() (role-gated) then runs TWO queries:
// a paged select and a COUNT(*). Mock both with the fluent chain style used
// by the other action tests.
const verifySessionMock = vi.fn();

vi.mock("@/lib/session", () => ({
  verifySession: (...args: unknown[]) => verifySessionMock(...args),
}));

let mockLogRows: unknown[] = [];
// Captures every `.where(...)` argument so tests can assert the combined
// filter predicate reached BOTH the select and the count query.
const mockWhereConditions: unknown[] = [];
const selectSpyMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      selectSpyMock(...args);
      if (args[0] && typeof args[0] === "object") {
        // COUNT query: db.select({ count }).from(t).where(...)
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = (c: unknown) => {
          mockWhereConditions.push(c);
          return Promise.resolve([{ count: 2 }]);
        };
        return chain;
      }
      // Data query: db.select().from(t).where(...).orderBy(...).limit(...).offset(...)
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = (c: unknown) => {
        mockWhereConditions.push(c);
        return chain;
      };
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.offset = () => Promise.resolve(mockLogRows);
      return chain;
    },
  },
}));

import { getAuditLogs } from "./audit";

const adminSession = {
  userId: 1,
  username: "alice",
  role: "admin",
  activeSiteId: 7,
  activeSiteName: "DC-JKT",
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    username: "alice",
    userRole: "admin",
    action: "LOGIN",
    entity: null,
    entityId: null,
    entityName: null,
    detail: "Login successful",
    siteId: 7,
    siteName: "DC-JKT",
    createdAt: new Date("2026-08-18T01:00:00Z"),
    ...overrides,
  };
}

describe("getAuditLogs", () => {
  const dialect = new PgDialect();

  beforeEach(() => {
    verifySessionMock.mockReset();
    mockLogRows = [makeRow()];
    mockWhereConditions.length = 0;
    selectSpyMock.mockClear();
  });

  it("returns empty without querying when the session is not admin/superadmin", async () => {
    verifySessionMock.mockResolvedValueOnce({ ...adminSession, role: "staff" });

    const result = await getAuditLogs({ entity: "device" });

    expect(result).toEqual({ logs: [], total: 0 });
    expect(selectSpyMock).not.toHaveBeenCalled();
  });

  it("returns all logs with no filter applied up to the limit/offset", async () => {
    verifySessionMock.mockResolvedValueOnce(adminSession);

    const result = await getAuditLogs({ limit: 25, offset: 50 });

    expect(selectSpyMock).toHaveBeenCalledTimes(2);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].username).toBe("alice");
    expect(result.total).toBe(2);
  });

  it("applies the combined entity/action/search predicate to BOTH the select and the count", async () => {
    verifySessionMock.mockResolvedValueOnce(adminSession);

    const result = await getAuditLogs({ entity: "device", action: "CREATE", search: "xyz" });

    // Both queries received the same combined `and(...)` condition.
    expect(mockWhereConditions).toHaveLength(2);
    expect(mockWhereConditions[0]).toBeDefined();
    expect(mockWhereConditions[1]).toBeDefined();

    // The predicate reaches the active parameter values in order.
    const params = mockWhereConditions.map((c) => dialect.sqlToQuery(c as never).params);
    for (const p of params) {
      expect(p).toEqual(expect.arrayContaining(["device", "CREATE", "%xyz%"]));
    }

    // Results and totals flow through.
    expect(result.logs).toHaveLength(1);
    expect(result.total).toBe(2);
  });

  it("filters by entity alone", async () => {
    verifySessionMock.mockResolvedValueOnce(adminSession);

    await getAuditLogs({ entity: "rack" });

    expect(mockWhereConditions).toHaveLength(2);
    const params = dialect.sqlToQuery(mockWhereConditions[0] as never).params;
    expect(params).toEqual(expect.arrayContaining(["rack"]));
  });

  it("counts the FILTERED set, not the whole table", async () => {
    verifySessionMock.mockResolvedValueOnce(adminSession);

    const result = await getAuditLogs({ action: "DELETE" });

    // The count query must receive the same predicate as the select — a
    // regression guard for the original bug where COUNT(*) skipped .where().
    expect(mockWhereConditions).toHaveLength(2);
    const params = mockWhereConditions.map((c) => dialect.sqlToQuery(c as never).params);
    for (const p of params) {
      expect(p).toEqual(expect.arrayContaining(["DELETE"]));
    }
    expect(result.total).toBe(2);
  });
});