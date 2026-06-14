import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module before importing the SUT.
vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import { db } from "../../db";
import { archiveFindingEvidence, buildEvidenceSnapshot, type JoinedEventRow } from "./evidence";
import { siemEvidenceEvents, siemFindings, syslogEvents, syslogEventsRaw } from "../../db/schema";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const baseRow: JoinedEventRow = {
  id: 42,
  eventTime: new Date("2026-06-01T10:00:00.000Z"),
  receivedAt: new Date("2026-06-01T10:00:01.000Z"),
  sourceIp: "10.0.0.5",
  hostname: "fw-01",
  deviceId: 7,
  sourceId: 3,
  message: "login failed",
  rawMessage: "<13>Jun 1 10:00:00 fw-01 login failed",
  category: "Authentication",
  normalizedType: "auth.login_failed",
  action: "login",
  outcome: "failure",
  srcIp: "192.168.1.9",
  dstIp: "10.0.0.5",
  username: "admin",
  severity: 4,
  metadata: { vendor: "fortigate" },
};

function makeJoinedRow(id: number): JoinedEventRow {
  return { ...baseRow, id };
}

// Build a chain: select(<args>).from(syslogEvents).leftJoin(...).where(<pred>) -> rows
function makeSelectFromLeftJoinWhereChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ leftJoin });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, leftJoin, where };
}

// Build a chain: insert(table).values(rows).onConflictDoNothing(opts).returning(sel) -> returnedRows
function makeInsertValuesOnConflictReturningChain(returnedRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoNothing, returning };
}

// Build a chain: update(table).set(patch).where(pred) -> Promise
function makeUpdateSetWhereChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("buildEvidenceSnapshot", () => {
  it("copies all evidence columns and stamps the finding + original event id", () => {
    const snap = buildEvidenceSnapshot(99, baseRow);
    expect(snap).toMatchObject({
      findingId: 99,
      originalEventId: 42,
      sourceIp: "10.0.0.5",
      message: "login failed",
      rawMessage: "<13>Jun 1 10:00:00 fw-01 login failed",
      normalizedType: "auth.login_failed",
      username: "admin",
      severity: 4,
      metadata: { vendor: "fortigate" },
    });
  });

  it("self-contains rawMessage so the snapshot survives deletion of the raw row", () => {
    const snap = buildEvidenceSnapshot(99, baseRow);
    expect(snap.rawMessage).toBe("<13>Jun 1 10:00:00 fw-01 login failed");
  });

  it("defaults a null metadata to an empty object", () => {
    const snap = buildEvidenceSnapshot(99, { ...baseRow, metadata: null });
    expect(snap.metadata).toEqual({});
  });

  it("preserves nullable fields as null", () => {
    const snap = buildEvidenceSnapshot(99, { ...baseRow, hostname: null, rawMessage: null, username: null });
    expect(snap.hostname).toBeNull();
    expect(snap.rawMessage).toBeNull();
    expect(snap.username).toBeNull();
  });
});

describe("archiveFindingEvidence", () => {
  it("returns 0 and still marks archived when sampleEventIds is empty", async () => {
    const upd = makeUpdateSetWhereChain();
    mockedDb.update.mockReturnValueOnce(upd.update());

    const result = await archiveFindingEvidence({ id: 1, sampleEventIds: [] });

    expect(result).toBe(0);
    expect(mockedDb.select).not.toHaveBeenCalled();
    expect(mockedDb.insert).not.toHaveBeenCalled();
    expect(upd.set).toHaveBeenCalledWith(expect.objectContaining({ evidenceArchived: true }));
    expect(upd.where).toHaveBeenCalled();
  });

  it("returns 5 (all new) when none of the 5 sample events are already archived", async () => {
    const ids = [101, 102, 103, 104, 105];
    const joinedRows = ids.map(makeJoinedRow);

    const sel = makeSelectFromLeftJoinWhereChain(joinedRows);
    mockedDb.select.mockReturnValueOnce(sel.select());

    const insertedRows = ids.map((id, i) => ({ id: i + 1 }));
    const ins = makeInsertValuesOnConflictReturningChain(insertedRows);
    mockedDb.insert.mockReturnValueOnce(ins.insert());

    const upd = makeUpdateSetWhereChain();
    mockedDb.update.mockReturnValueOnce(upd.update());

    const result = await archiveFindingEvidence({ id: 42, sampleEventIds: ids });

    expect(result).toBe(5);
    expect(sel.from).toHaveBeenCalledWith(syslogEvents);
    expect(sel.leftJoin).toHaveBeenCalledWith(syslogEventsRaw, expect.anything());
    expect(sel.where).toHaveBeenCalledTimes(1);

    expect(mockedDb.insert).toHaveBeenCalledTimes(1);
    expect(mockedDb.insert).toHaveBeenCalledWith(siemEvidenceEvents);
    expect(ins.values).toHaveBeenCalledTimes(1);
    const snapshotsArg = ins.values.mock.calls[0][0] as Array<{ findingId: number; originalEventId: number }>;
    expect(snapshotsArg).toHaveLength(5);
    expect(snapshotsArg.every((s) => s.findingId === 42)).toBe(true);
    expect(snapshotsArg.map((s) => s.originalEventId).sort()).toEqual([...ids].sort());

    // The conflict target must be the (findingId, originalEventId) pair.
    expect(ins.onConflictDoNothing).toHaveBeenCalledWith({
      target: [siemEvidenceEvents.findingId, siemEvidenceEvents.originalEventId],
    });
    expect(ins.returning).toHaveBeenCalledWith({ id: siemEvidenceEvents.id });

    expect(upd.set).toHaveBeenCalledWith(expect.objectContaining({ evidenceArchived: true }));
  });

  it("returns 0 when all 5 ids already have archived rows (conflict skips every insert)", async () => {
    const ids = [201, 202, 203, 204, 205];
    const joinedRows = ids.map(makeJoinedRow);

    const sel = makeSelectFromLeftJoinWhereChain(joinedRows);
    mockedDb.select.mockReturnValueOnce(sel.select());

    // Drizzle returns [] from .returning() when all rows hit the ON CONFLICT.
    const ins = makeInsertValuesOnConflictReturningChain([]);
    mockedDb.insert.mockReturnValueOnce(ins.insert());

    const upd = makeUpdateSetWhereChain();
    mockedDb.update.mockReturnValueOnce(upd.update());

    const result = await archiveFindingEvidence({ id: 7, sampleEventIds: ids });

    expect(result).toBe(0);
    expect(ins.values).toHaveBeenCalledTimes(1);
    expect(ins.onConflictDoNothing).toHaveBeenCalledWith({
      target: [siemEvidenceEvents.findingId, siemEvidenceEvents.originalEventId],
    });
    // Finding is still marked archived — the unique-constraint + returning path
    // does not need a separate read of the existing evidence set.
    expect(upd.set).toHaveBeenCalledWith(expect.objectContaining({ evidenceArchived: true }));
  });

  it("returns 2 (only new) when 3 of 5 sample events are already archived", async () => {
    const ids = [301, 302, 303, 304, 305];
    const joinedRows = ids.map(makeJoinedRow);

    const sel = makeSelectFromLeftJoinWhereChain(joinedRows);
    mockedDb.select.mockReturnValueOnce(sel.select());

    // Drizzle .returning() reports only the 2 rows that were actually inserted.
    const ins = makeInsertValuesOnConflictReturningChain([{ id: 9001 }, { id: 9002 }]);
    mockedDb.insert.mockReturnValueOnce(ins.insert());

    const upd = makeUpdateSetWhereChain();
    mockedDb.update.mockReturnValueOnce(upd.update());

    const result = await archiveFindingEvidence({ id: 9, sampleEventIds: ids });

    expect(result).toBe(2);
    // All 5 snapshots were offered to the DB; the unique index silently
    // dropped the 3 conflicts and only the 2 new rows came back from returning.
    const snapshotsArg = ins.values.mock.calls[0][0] as Array<{ originalEventId: number }>;
    expect(snapshotsArg).toHaveLength(5);
  });

  it("a second concurrent insert of the same (findingId, originalEventId) tuple is silently skipped via onConflictDoNothing", async () => {
    // Simulates the race: retention and parser worker both try to archive the
    // same tuple. First insert wins; the second insert's .returning() yields
    // an empty result, but the call does not throw.
    const ids = [501];
    const sel = makeSelectFromLeftJoinWhereChain([makeJoinedRow(501)]);
    mockedDb.select.mockReturnValueOnce(sel.select());

    const ins = makeInsertValuesOnConflictReturningChain([]);
    mockedDb.insert.mockReturnValueOnce(ins.insert());

    const upd = makeUpdateSetWhereChain();
    mockedDb.update.mockReturnValueOnce(upd.update());

    const result = await archiveFindingEvidence({ id: 11, sampleEventIds: ids });

    expect(result).toBe(0);
    expect(ins.onConflictDoNothing).toHaveBeenCalledWith({
      target: [siemEvidenceEvents.findingId, siemEvidenceEvents.originalEventId],
    });
  });

  it("does not insert anything when no matching syslog_events rows are found", async () => {
    const sel = makeSelectFromLeftJoinWhereChain([]);
    mockedDb.select.mockReturnValueOnce(sel.select());

    const upd = makeUpdateSetWhereChain();
    mockedDb.update.mockReturnValueOnce(upd.update());

    const result = await archiveFindingEvidence({ id: 12, sampleEventIds: [999, 1000] });

    expect(result).toBe(0);
    expect(mockedDb.insert).not.toHaveBeenCalled();
    expect(upd.set).toHaveBeenCalledWith(expect.objectContaining({ evidenceArchived: true }));
  });
});

// Reference symbols so they don't get flagged as unused by tooling.
void siemFindings;
