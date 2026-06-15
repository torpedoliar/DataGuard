import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module before importing the SUT.
vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

import { db } from "../../db";
import { captureSiemSnapshot, getSiemSnapshots } from "./snapshots";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

// select(<args?>).from(table).where(<pred>) → rows
function makeSelectFromWhere(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

// select(<args?>).from(table).where(<pred>).orderBy(<args>) → rows
function makeSelectFromWhereOrderBy(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, orderBy };
}

// insert(table).values(rows).returning({...}) → [{ id, capturedAt }]
function makeInsertReturning(values: unknown[]) {
  const returning = vi.fn().mockResolvedValue(values);
  const innerValues = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values: innerValues });
  return { insert, values: innerValues, returning };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("captureSiemSnapshot", () => {
  it("reads the seven counters and persists a snapshot row, returning the captured values", async () => {
    // 7 counter selects in captureSiemSnapshot. Each call to db.select({count}) must
    // return an object that has .from(...).where(...) → rows; we pass the full chain
    // object (which exposes a `.select` mock too) as the return value of db.select.
    const c1 = makeSelectFromWhere([{ count: 100 }]); // raw24h
    const c2 = makeSelectFromWhere([{ count: 80 }]);  // parsed24h
    const c3 = makeSelectFromWhere([{ count: 5 }]);   // openFindings
    const c4 = makeSelectFromWhere([{ count: 2 }]);   // criticalFindings
    const c5 = makeSelectFromWhere([{ count: 1 }]);   // unmappedSources
    const c6 = makeSelectFromWhere([{ count: 3 }]);   // pendingAlerts
    const c7 = makeSelectFromWhere([{ count: 4 }]);   // failedAlerts
    mockedDb.select
      .mockReturnValueOnce(c1)
      .mockReturnValueOnce(c2)
      .mockReturnValueOnce(c3)
      .mockReturnValueOnce(c4)
      .mockReturnValueOnce(c5)
      .mockReturnValueOnce(c6)
      .mockReturnValueOnce(c7);

    const capturedAt = new Date("2026-06-15T10:00:00.000Z");
    const ins = makeInsertReturning([{ id: 42, capturedAt }]);
    mockedDb.insert.mockReturnValueOnce(ins.insert());

    const result = await captureSiemSnapshot();

    expect(result.counters).toEqual({
      raw24h: 100,
      parsed24h: 80,
      openFindings: 5,
      criticalFindings: 2,
      unmappedSources: 1,
      pendingAlerts: 3,
      failedAlerts: 4,
    });
    expect(result.capturedAt).toEqual(capturedAt);
    // The insert was performed exactly once with the counter values.
    expect(mockedDb.insert).toHaveBeenCalledTimes(1);
    expect(ins.values).toHaveBeenCalledWith({
      raw24h: 100,
      parsed24h: 80,
      openFindings: 5,
      criticalFindings: 2,
      unmappedSources: 1,
      pendingAlerts: 3,
      failedAlerts: 4,
    });
    expect(ins.returning).toHaveBeenCalled();
  });

  it("coerces null/undefined count rows to zero", async () => {
    const chain = makeSelectFromWhere([]);
    mockedDb.select.mockReturnValue(chain);
    const capturedAt = new Date("2026-06-15T11:00:00.000Z");
    const ins = makeInsertReturning([{ id: 1, capturedAt }]);
    mockedDb.insert.mockReturnValueOnce(ins.insert());

    const result = await captureSiemSnapshot();
    expect(result.counters).toEqual({
      raw24h: 0,
      parsed24h: 0,
      openFindings: 0,
      criticalFindings: 0,
      unmappedSources: 0,
      pendingAlerts: 0,
      failedAlerts: 0,
    });
  });
});

describe("getSiemSnapshots", () => {
  it("queries with the since predicate and returns rows mapped to SiemSnapshot", async () => {
    const row1 = {
      id: 1,
      capturedAt: new Date("2026-06-15T08:00:00.000Z"),
      raw24h: 10,
      parsed24h: 9,
      openFindings: 2,
      criticalFindings: 1,
      unmappedSources: 0,
      pendingAlerts: 1,
      failedAlerts: 0,
    };
    const row2 = {
      id: 2,
      capturedAt: new Date("2026-06-15T09:00:00.000Z"),
      raw24h: 20,
      parsed24h: 18,
      openFindings: 3,
      criticalFindings: 0,
      unmappedSources: 1,
      pendingAlerts: 2,
      failedAlerts: 1,
    };

    const chain = makeSelectFromWhereOrderBy([row1, row2]);
    mockedDb.select.mockReturnValueOnce(chain);

    const out = await getSiemSnapshots("2026-06-15T00:00:00.000Z");

    expect(chain.where).toHaveBeenCalled();
    const predArg = chain.where.mock.calls[0][0];
    expect(predArg).toBeDefined();
    expect(chain.orderBy).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalled();

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: 1,
      capturedAt: row1.capturedAt,
      raw24h: 10,
      parsed24h: 9,
      openFindings: 2,
      criticalFindings: 1,
      unmappedSources: 0,
      pendingAlerts: 1,
      failedAlerts: 0,
    });
    expect(out[1].id).toBe(2);
  });

  it("returns an empty array when no snapshots match the since filter", async () => {
    const chain = makeSelectFromWhereOrderBy([]);
    mockedDb.select.mockReturnValueOnce(chain);
    const out = await getSiemSnapshots("2030-01-01T00:00:00.000Z");
    expect(out).toEqual([]);
  });
});
