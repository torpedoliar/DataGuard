import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), access: vi.fn(), context: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAction: mocks.guard }));
vi.mock("@/lib/site-access", () => ({ requireSiteAccess: mocks.access }));
vi.mock("./epdr-endpoints", () => ({ loadSecurityContext: mocks.context }));
vi.mock("@/lib/epdr/display-time-zone", () => ({ loadEpdrDisplayTimeZone: vi.fn(async () => ({ timeZone: "UTC" })) }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
import { getEpdrThreats, getEpdrThreatTable } from "./epdr-threats";
import { loadEpdrDisplayTimeZone } from "@/lib/epdr/display-time-zone";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadEpdrDisplayTimeZone).mockResolvedValue({ personalTimeZone: null, siteTimeZone: "UTC", timeZone: "UTC" });
});
describe("threat inventory membership", () => {
  it("rejects absent active site before context/database reads", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "No site" });
    expect(await getEpdrThreats()).toEqual({ message: "No site" });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("returns safe unauthorized on revoked membership rather than throwing from shared context", async () => {
    mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { role: "admin" } });
    mocks.access.mockResolvedValue(false);
    expect(await getEpdrThreats()).toEqual({ message: "Unauthorized." });
    expect(mocks.access).toHaveBeenCalledWith(7);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("rechecks revoked membership on subsequent table requests", async () => {
    mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { role: "admin" } });
    mocks.access.mockResolvedValue(false);
    expect(await getEpdrThreatTable({ page: 12 })).toEqual({ message: "Unauthorized." });
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("rejects invalid ranges and non-admin ignored requests before querying", async () => {
    mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { role: "user" } });
    mocks.access.mockResolvedValue(true);
    mocks.context.mockResolvedValue({ isAdmin: false });
    expect(await getEpdrThreatTable({ scoreMode: "range", minScore: 10, maxScore: 3 })).toEqual({ message: "Invalid threat query." });
    expect(await getEpdrThreatTable({ ignored: true })).toEqual({ message: "Unauthorized." });
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("uses identical count/row predicate and returns real total beyond 500", async () => {
    mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { role: "user" } });
    mocks.access.mockResolvedValue(true);
    const wheres: SQL[] = [];
    const offset = vi.fn();
    const limit = vi.fn();
    const dialect = new PgDialect();
    let call = 0;
    mocks.select.mockImplementation(() => {
      const result = call++ === 0 ? [{ accountRevision: 3 }] : call === 2 ? [{ id: 551, accountRevision: 3 }] : [{ total: 701 }];
      const chain = {
        from: () => chain, leftJoin: () => chain,
        where: (where: SQL) => { wheres.push(where); return chain; },
        orderBy: () => chain,
        limit: (value: number) => { limit(value); return chain; },
        offset: (value: number) => { offset(value); return Promise.resolve(result); },
        then: (resolve: (rows: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    });
    const result = await getEpdrThreatTable({ page: 12, query: "host", source: "threatsync", scoreMode: "missing" });
    expect(result).toEqual({ rows: [{ id: 551, historical: false }], total: 701, page: 12, pageSize: 50 });
    expect(limit).toHaveBeenCalledWith(50);
    expect(offset).toHaveBeenCalledWith(550);
    expect(dialect.sqlToQuery(wheres[1])).toEqual(dialect.sqlToQuery(wheres[2]));
  });
  it("aggregates full SQL results without sampled summary rows", async () => {
    mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { role: "user" } });
    mocks.access.mockResolvedValue(true);
    mocks.context.mockResolvedValue({ isAdmin: false });
    vi.mocked(loadEpdrDisplayTimeZone).mockResolvedValue({ personalTimeZone: "Asia/Jakarta", siteTimeZone: "UTC", timeZone: "Asia/Jakarta" });
    const results = [[{ accountRevision: 0 }], [], [{ total: 800 }], [{ category: "malware", last24h: 700, last7d: 800 }], [{ date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), category: "malware", total: 800 }], [{ total: 2 }]];
    const selections: Record<string, SQL>[] = [];
    mocks.select.mockImplementation((selection) => {
      selections.push(selection);
      const result = results.shift();
      const chain = {
        from: () => chain, leftJoin: () => chain, where: () => chain, groupBy: () => chain,
        orderBy: () => chain, limit: () => chain, offset: () => Promise.resolve(result),
        then: (resolve: (rows: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    });
    const result = await getEpdrThreats();
    expect(result).toMatchObject({ activeCount: 2, categoryTotals: { malware: { last24h: 700, last7d: 800 } }, detectionPage: { total: 800 } });
    if (!("message" in result)) expect(result.trend.reduce((n, d) => n + d.total, 0)).toBe(800);
    const dayQuery = new PgDialect().sqlToQuery(selections[4].date);
    expect(dayQuery.sql).toContain("at time zone 'UTC') at time zone");
    expect(dayQuery.params).toEqual(["Asia/Jakarta"]);
    expect(result).toMatchObject({ trendTimeZone: "Asia/Jakarta" });
    const activeSql = new PgDialect().sqlToQuery(selections[5].total).sql;
    expect(activeSql).toContain("count(distinct");
    expect(activeSql).toContain("'Open', 'In Progress'");
  });
});
