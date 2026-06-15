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

    // (3) unarchived findings select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

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

    // db.transaction runs the insert+delete atomically. Capture the values.
    let capturedQuarantineValues: unknown[] | undefined;
    const txInsertChain = makeInsertChain();
    txInsertChain.values.mockImplementation((rows: unknown[]) => {
      capturedQuarantineValues = Array.isArray(rows) ? rows : [rows];
      return Promise.resolve(undefined);
    });
    const txDeleteChain = makeDeleteChain([{ id: 555 }]);
    const tx = {
      insert: vi.fn().mockReturnValue(txInsertChain.insert()),
      delete: vi.fn().mockReturnValue(txDeleteChain.delete()),
    };
    mockedDb.transaction.mockImplementationOnce(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx));

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

    // db.transaction must have been called
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
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

    // unarchived findings select → []
    mockedDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

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

// Reference symbols so they don't get flagged as unused by tooling.
void syslogEvents;
void syslogSources;
void siemEventsQuarantine;
