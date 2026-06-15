import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module before importing the SUT.
vi.mock("../../db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(),
    },
  };
});

vi.mock("./evidence", () => ({
  archiveFindingEvidence: vi.fn().mockResolvedValue(undefined),
  archiveFindingEvidenceInTx: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./partitioning", () => {
  const weeks = [{ start: new Date("2026-06-08T00:00:00.000Z"), end: new Date("2026-06-15T00:00:00.000Z"), suffix: "20260608" }];
  const partitionsForWindow = vi.fn(() => weeks);
  const isPartitionFullyExpired = vi.fn(() => false);
  const partitionName = vi.fn(() => "p_mock");
  return { partitionsForWindow, isPartitionFullyExpired, partitionName };
});

import { db } from "../../db";
import {
  buildSiemRetentionCutoffs,
  DEFAULT_SIEM_RETENTION_DAYS,
  normalizeRetentionDays,
  resolveSourceCutoffDays,
  mostLenientEventCutoff,
  runSiemRetentionCleanup,
} from "./retention";
import { archiveFindingEvidenceInTx } from "./evidence";
import { siemEventsQuarantine, syslogEvents, syslogSources } from "../../db/schema";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: any db.execute call without a queued mock returns an empty result.
  // Tests queue their specific expectations via mockResolvedValueOnce.
  mockedDb.execute.mockImplementation(() => Promise.resolve({ rows: [] }));
});

afterEach(() => {
  vi.resetAllMocks();
});

/**
 * Build a chainable select mock for "SELECT ... FROM siem_settings LIMIT 1" (or similar
 * single-row call). Subsequent .where()/.limit() calls return what the test sets on
 * the chain object.
 */
function makeSelectChain(rows: unknown[] | { rows: unknown[] }) {
  const lim = vi.fn().mockResolvedValue(rows);
  const wh = vi.fn().mockReturnValue({ limit: lim, orderBy: vi.fn().mockReturnThis(), then: undefined });
  const from = vi.fn().mockReturnValue({ where: wh, limit: vi.fn().mockReturnThis() });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where: wh, limit: lim };
}

/**
 * Build a chainable select mock for the source list query
 * (select({id, eventRetentionDays}).from(syslogSources)). No where.
 */
function makeSourcesChain(rows: unknown[]) {
  const from = vi.fn().mockResolvedValue(rows);
  const select = vi.fn().mockReturnValue({ from });
  return { select, from };
}

function makeExecuteChain(result: unknown) {
  const exec = vi.fn().mockResolvedValue(result);
  return exec;
}

function makeDeleteChain(returning: unknown[] = []) {
  const ret = vi.fn().mockResolvedValue(returning);
  const wh = vi.fn().mockReturnValue({ returning: ret });
  const del = vi.fn().mockReturnValue({ where: wh });
  return { delete: del, where: wh, returning: ret };
}

function makeInsertChain() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values };
}

describe("SIEM retention", () => {
  it("normalizes invalid retention values to defaults", () => {
    expect(normalizeRetentionDays(null, 90)).toBe(90);
    expect(normalizeRetentionDays(0, 90)).toBe(90);
    expect(normalizeRetentionDays(-1, 90)).toBe(90);
    expect(normalizeRetentionDays(1.9, 90)).toBe(1);
  });

  it("builds cutoff dates from settings", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const cutoffs = buildSiemRetentionCutoffs({ rawRetentionDays: 2, eventRetentionDays: 3, findingRetentionDays: 4, alertRetentionDays: 5 }, now);

    expect(cutoffs.raw.toISOString()).toBe("2026-05-22T12:00:00.000Z");
    expect(cutoffs.events.toISOString()).toBe("2026-05-21T12:00:00.000Z");
    expect(cutoffs.findings.toISOString()).toBe("2026-05-20T12:00:00.000Z");
    expect(cutoffs.alerts.toISOString()).toBe("2026-05-19T12:00:00.000Z");
  });

  it("uses default cutoffs when settings are absent", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const cutoffs = buildSiemRetentionCutoffs(null, now);

    expect(cutoffs.raw.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.raw * 24 * 60 * 60 * 1000);
    expect(cutoffs.events.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.events * 24 * 60 * 60 * 1000);
    expect(cutoffs.findings.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.findings * 24 * 60 * 60 * 1000);
    expect(cutoffs.alerts.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.alerts * 24 * 60 * 60 * 1000);
  });

  it("resolves a source cutoff using its override, falling back to the global default", () => {
    expect(resolveSourceCutoffDays(30, 180)).toBe(30);
    expect(resolveSourceCutoffDays(null, 180)).toBe(180);
    expect(resolveSourceCutoffDays(0, 180)).toBe(180); // invalid override → global
    expect(resolveSourceCutoffDays(-5, 180)).toBe(180);
  });

  it("computes the most lenient event cutoff across sources and the global default", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    // sources: 7d override, null (uses global 180), 30d override; global 180
    const cutoff = mostLenientEventCutoff(
      [{ eventRetentionDays: 7 }, { eventRetentionDays: null }, { eventRetentionDays: 30 }],
      180,
      now,
    );
    // most lenient = 180 days back
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("uses the largest override when it exceeds the global default", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    const cutoff = mostLenientEventCutoff(
      [{ eventRetentionDays: 400 }, { eventRetentionDays: 30 }],
      180,
      now,
    );
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("runSiemRetentionCleanup — quarantine", () => {
  it("moves orphan events to quarantine and deletes them from syslog_events when quarantineEnabled is true", async () => {
    // (1) settings query via db.execute (raw SQL)
    mockedDb.execute.mockResolvedValueOnce({
      rows: [
        {
          raw_retention_days: 90,
          event_retention_days: 180,
          finding_retention_days: 365,
          alert_retention_days: 365,
          quarantine_enabled: true,
          quarantine_retention_days: 365,
        },
      ],
    });
    // (2) sources select (no per-source override → all skipped at source level)
    mockedDb.select.mockReturnValueOnce(makeSourcesChain([]));

    // (3) unarchived findings select → []. The candidate select is now run on
    // the transaction handle (not on db), so we only need to set up a tx mock.
    // db.select is NOT consumed for the unarchived-findings query any more.
    // db.select is still used for: sources, orphan events, quarantine retention, stale findings.

    // db.transaction runs the insert+delete atomically. Capture the values.
    // The unarchived-findings select is also on the tx, returning [].
    // The chain looks like: tx.select(...).from(...).where(...).limit(N).for("update", {skipLocked:true})
    // The terminal (after .for()) must be a thenable resolving to the row set.
    const terminalThenable: { then: (r: (v: unknown[]) => unknown) => Promise<unknown> } = {
      then: (r: (v: unknown[]) => unknown) => Promise.resolve(r([])),
    };
    // The "after .limit()" node still has .for() (Drizzle's locking clause
    // can be appended to the limited select).
    const afterLimit = { for: vi.fn().mockReturnValue(terminalThenable) };
    let capturedQuarantineValues: unknown[] | undefined;
    const txInsertChain = makeInsertChain();
    txInsertChain.values.mockImplementation((rows: unknown[]) => {
      capturedQuarantineValues = Array.isArray(rows) ? rows : [rows];
      return Promise.resolve(undefined);
    });
    const txDeleteChain = makeDeleteChain([{ id: 555 }]);
    // .where(...) → has both .limit() and .for(); both terminators return the same thenable.
    const txWhereResult = {
      limit: vi.fn().mockReturnValue(afterLimit),
      for: vi.fn().mockReturnValue(terminalThenable),
    };
    const txSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(txWhereResult) }),
    });
    const tx = {
      select: txSelect,
      insert: vi.fn().mockReturnValue(txInsertChain.insert()),
      delete: vi.fn().mockReturnValue(txDeleteChain.delete()),
    };
    // First call: the archive phase (FOR UPDATE SKIP LOCKED + per-finding archive).
    // Second call: the quarantine insert+delete atomic pair.
    mockedDb.transaction
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    // (4) orphan-event select (sourceId IS NULL) returns one row
    const orphanVictim = {
      id: 555,
      rawEventId: null,
      eventTime: new Date("2026-01-01T00:00:00.000Z"),
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      sourceIp: "10.0.0.99",
      hostname: "ghost-1",
      severity: 4,
      message: "orphan message",
    };
    const orphanSelect = {
      limit: vi.fn().mockResolvedValue([orphanVictim]),
      orderBy: vi.fn().mockReturnThis(),
    };
    const orphanWhere = vi.fn().mockReturnValue(orphanSelect);
    const orphanFrom = vi.fn().mockReturnValue({ where: orphanWhere, limit: vi.fn().mockReturnThis() });
    mockedDb.select.mockReturnValueOnce({ from: orphanFrom });

    // (5) quarantine retention: select old rows → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    // (6) syslogEventsRaw delete → []
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    // (7) siemAlerts delete → []
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    // (8) findings select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await runSiemRetentionCleanup({ now: new Date("2026-06-15T00:00:00.000Z") });

    // db.transaction was called twice: once for the archive phase (FOR UPDATE
    // SKIP LOCKED), once for the quarantine insert+delete atomic pair.
    expect(mockedDb.transaction).toHaveBeenCalledTimes(2);
    // The insert into quarantine must have run inside the transaction
    expect(tx.insert).toHaveBeenCalled();
    expect(txInsertChain.values).toHaveBeenCalledTimes(1);
    expect(capturedQuarantineValues).toBeDefined();
    const insertedValue = (capturedQuarantineValues as Array<Record<string, unknown>>)[0];
    expect(insertedValue).toMatchObject({
      originalEventId: 555,
      sourceIp: "10.0.0.99",
      hostname: "ghost-1",
      message: "orphan message",
      severity: 4,
      rawEventId: null,
    });
    expect(String(insertedValue.quarantinedReason)).toMatch(/sourceId null past retention cutoff/i);

    // DELETE on syslog_events should have run inside the transaction too
    expect(tx.delete).toHaveBeenCalled();
    expect(txDeleteChain.where).toHaveBeenCalled();

    expect(result.eventsQuarantined).toBe(1);
    expect(result.eventsDeleted).toBe(0);
    expect(result.quarantineRetentionDeleted).toBe(0);
  });

  it("deletes rows from siem_events_quarantine older than quarantineRetentionDays", async () => {
    mockedDb.execute.mockResolvedValueOnce({
      rows: [
        {
          raw_retention_days: 90,
          event_retention_days: 180,
          finding_retention_days: 365,
          alert_retention_days: 365,
          quarantine_enabled: true,
          quarantine_retention_days: 30, // short window for test
        },
      ],
    });
    mockedDb.select.mockReturnValueOnce(makeSourcesChain([]));
    // unarchived findings select is on tx, not on db.select

    // No orphan events to quarantine (returns []).
    const emptyOrphanSelect = {
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
    };
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: emptyOrphanSelect.limit,
        }),
      }),
    });

    // quarantine retention: select old rows → 3
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]) }),
      }),
    });
    // delete them
    const qDel = makeDeleteChain([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mockedDb.delete.mockReturnValueOnce(qDel.delete());
    // drain select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    // syslogEventsRaw delete → []
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    // siemAlerts delete → []
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    // findings select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const result = await runSiemRetentionCleanup({ now: new Date("2026-06-15T00:00:00.000Z") });

    expect(qDel.where).toHaveBeenCalled();
    expect(result.quarantineRetentionDeleted).toBe(3);
    expect(result.eventsQuarantined).toBe(0);
  });
});

describe("runSiemRetentionCleanup — evidence archive atomicity (N29)", () => {
  function defaultSettings() {
    return {
      raw_retention_days: 90,
      event_retention_days: 180,
      finding_retention_days: 365,
      alert_retention_days: 365,
      quarantine_enabled: true,
      quarantine_retention_days: 365,
    };
  }

  /**
   * Builds a chainable tx.select() mock that returns `rows` for the
   * unarchived-findings query, including the .for("update", {skipLocked:true})
   * locking clause. The chain looks like:
   *   tx.select(...).from(...).where(...).limit(N).for("update", {skipLocked:true})
   * and the terminal (after .for()) is a thenable resolving to `rows`.
   */
  function makeUnarchivedTxSelect(rows: Array<{ id: number; sampleEventIds: number[] }>) {
    const terminal: { then: (r: (v: unknown[]) => unknown) => Promise<unknown> } = {
      then: (r: (v: unknown[]) => unknown) => Promise.resolve(r(rows)),
    };
    const forFn = vi.fn().mockReturnValue(terminal);
    const chain: { limit: unknown; for: unknown; where?: unknown; from?: unknown } = { for: forFn, limit: undefined };
    const limit = vi.fn().mockReturnValue(chain);
    chain.limit = limit;
    const where = vi.fn().mockReturnValue(chain);
    chain.where = where;
    const from = vi.fn().mockReturnValue(chain);
    chain.from = from;
    const select = vi.fn().mockReturnValue(chain);
    return { select, from, where, limit, for: forFn };
  }

  it("selects unarchived findings with FOR UPDATE SKIP LOCKED inside a transaction", async () => {
    mockedDb.execute.mockResolvedValueOnce({ rows: [defaultSettings()] });
    // sources
    mockedDb.select.mockReturnValueOnce(makeSourcesChain([]));

    const archiveCalls: unknown[] = [];
    const capturedTxSelect = makeUnarchivedTxSelect([
      { id: 1, sampleEventIds: [10, 11] },
      { id: 2, sampleEventIds: [] },
    ]);
    const tx = {
      select: capturedTxSelect.select,
    };
    mockedDb.transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    (archiveFindingEvidenceInTx as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (passedTx: unknown, finding: unknown) => {
      archiveCalls.push({ tx: passedTx, finding });
      return 0;
    });

    // The remaining selects/deletes in the run return empty.
    // orphan events select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    // quarantine retention select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const result = await runSiemRetentionCleanup({ now: new Date("2026-06-15T00:00:00.000Z") });

    // The unarchived-findings select was performed on the transaction handle, not on db.
    expect(tx.select).toHaveBeenCalled();
    // The candidate select used the FOR UPDATE SKIP LOCKED locking clause.
    expect(capturedTxSelect.for).toHaveBeenCalledWith("update", { skipLocked: true });
    // archiveFindingEvidenceInTx was called once per unarchived finding, on the tx.
    expect(archiveFindingEvidenceInTx).toHaveBeenCalledTimes(2);
    expect((archiveCalls[0] as { tx: unknown }).tx).toBe(tx);
    expect((archiveCalls[0] as { finding: { id: number } }).finding.id).toBe(1);
    expect((archiveCalls[1] as { finding: { id: number } }).finding.id).toBe(2);
    expect(result.evidenceArchivedFindings).toBe(2);
    // The legacy public archiveFindingEvidence must NOT be called from retention.
    expect((await import("./evidence")).archiveFindingEvidence).toBeDefined();
  });

  it("two concurrent retention calls each archive a disjoint set of findings (SKIP LOCKED prevents double-archive)", async () => {
    /**
     * The first call's tx.select(...) holds the row locks; the second call's
     * tx.select(...) returns an empty row set because the rows are locked.
     * Concretely: candidate select #1 returns both findings, candidate select #2
     * returns none. The aggregate processed set has both findings, neither is
     * processed twice.
     */
    // Both calls' settings queries return the same shape. Use mockResolvedValue
    // (no Once) so each of the 2 calls gets a settings row. We then queue
    // every other execute (CREATE/DROP) as a default-returning object, since
    // they only care about `rows` being an array.
    mockedDb.execute.mockImplementation((() => {
      let count = 0;
      return () => {
        count++;
        // First call from each run: the settings SELECT.
        // (Interleaving means we can't know which call is "first", so the
        // simplest correct setup is to return settings for the first 2
        // executes, then empty rows afterwards.)
        if (count <= 2) {
          return Promise.resolve({ rows: [defaultSettings()] });
        }
        return Promise.resolve({ rows: [] });
      };
    })());

    const call1Selects = makeUnarchivedTxSelect([
      { id: 100, sampleEventIds: [1] },
      { id: 101, sampleEventIds: [2] },
    ]);
    const call2Selects = makeUnarchivedTxSelect([]);

    const tx1 = { select: call1Selects.select };
    const tx2 = { select: call2Selects.select };

    mockedDb.transaction
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx1))
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx2));

    // Track which findings get processed (idempotent count).
    const processed = new Set<number>();
    (archiveFindingEvidenceInTx as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (passedTx: unknown, finding: { id: number }) => {
      // If the same finding is presented twice, fail the test.
      if (processed.has(finding.id)) {
        throw new Error(`Finding ${finding.id} was archived twice`);
      }
      processed.add(finding.id);
      return 0;
    });

    // Provide a generic chain for all db.select calls inside either run.
    // The runs are concurrent, so the order of mock consumption between the
    // two calls is not deterministic. We queue enough mocks to satisfy
    // EITHER ordering: 2 sources + 2 orphan + 2 quar + 2 stale.
    const emptyOrphan = {
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
    };
    const emptyQuar = {
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
    };
    const emptyStale = {
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
    };
    const sourcesChain = makeSourcesChain([]);
    mockedDb.select
      .mockReturnValueOnce(sourcesChain)
      .mockReturnValueOnce(sourcesChain)
      .mockReturnValueOnce(emptyOrphan)
      .mockReturnValueOnce(emptyOrphan)
      .mockReturnValueOnce(emptyQuar)
      .mockReturnValueOnce(emptyQuar)
      .mockReturnValueOnce(emptyStale)
      .mockReturnValueOnce(emptyStale);
    // raw events delete + alerts delete for both calls.
    mockedDb.delete
      .mockReturnValueOnce(makeDeleteChain([]).delete())
      .mockReturnValueOnce(makeDeleteChain([]).delete())
      .mockReturnValueOnce(makeDeleteChain([]).delete())
      .mockReturnValueOnce(makeDeleteChain([]).delete());

    const [res1, res2] = await Promise.all([
      runSiemRetentionCleanup({ now: new Date("2026-06-15T00:00:00.000Z") }),
      runSiemRetentionCleanup({ now: new Date("2026-06-15T00:00:00.000Z") }),
    ]);

    expect(res1.evidenceArchivedFindings + res2.evidenceArchivedFindings).toBe(2);
    // Whichever call ran first gets both findings; the second gets 0.
    expect([res1.evidenceArchivedFindings, res2.evidenceArchivedFindings].sort()).toEqual([0, 2]);
    expect(processed).toEqual(new Set([100, 101]));
    // Both calls applied the locking clause.
    expect(call1Selects.for).toHaveBeenCalledWith("update", { skipLocked: true });
    expect(call2Selects.for).toHaveBeenCalledWith("update", { skipLocked: true });
  });

  it("rolls back the whole archive transaction when archiveFindingEvidenceInTx throws (no partial state)", async () => {
    mockedDb.execute.mockResolvedValueOnce({ rows: [defaultSettings()] });
    mockedDb.select.mockReturnValueOnce(makeSourcesChain([]));

    const capturedTxSelect = makeUnarchivedTxSelect([
      { id: 1, sampleEventIds: [10, 11] },
      { id: 2, sampleEventIds: [20, 21] },
    ]);
    const tx = { select: capturedTxSelect.select };
    mockedDb.transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    // First archive call blows up; the second is never reached. Drizzle's
    // transaction wrapper would normally observe the rejection and roll back.
    (archiveFindingEvidenceInTx as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("simulated archive failure");
    });

    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
    });
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
    });
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    mockedDb.delete.mockReturnValueOnce(makeDeleteChain([]).delete());
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
    });

    await expect(
      runSiemRetentionCleanup({ now: new Date("2026-06-15T00:00:00.000Z") }),
    ).rejects.toThrow(/simulated archive failure/);

    // The candidate select ran on the tx (so locks were acquired on those 2 rows).
    expect(tx.select).toHaveBeenCalled();
    // Only the first archive call had a chance to run; the second finding was
    // never touched (and so could not be partially archived).
    expect(archiveFindingEvidenceInTx).toHaveBeenCalledTimes(1);
    // The transaction wrapper received the rejection; nothing past the archive
    // phase (the orphan-event select, the quarantine retention, the raw delete,
    // the alerts delete, the stale-findings select) ran, because the call
    // rejected out of the transaction.
    // The post-archive mocks queued on db.select/db.delete are never consumed.
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
  });
});

// Reference symbols so they don't get flagged as unused by tooling.
void syslogEvents;
void syslogSources;
void siemEventsQuarantine;
