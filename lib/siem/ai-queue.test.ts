import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module before importing the SUT so the queue helper can be
// exercised in isolation. We never hit the real Postgres pool in tests.
vi.mock("../../db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(),
    },
  };
});

// Mock the audit module so the worker does not require an active session.
vi.mock("../audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../../db";
import {
  queueSiemAiAnalysis,
  runSiemAiWorkerOnce,
} from "./ai-queue";
import { siemAiJobs, siemFindings, siemSettings } from "../../db/schema";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

// Chain: select().from(siemSettings).limit(1) → rows
function makeSettingsChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, limit };
}

function makeFinding(overrides: Partial<{ id: number; aiGeneratedAt: Date | null; severity: "Low" | "Medium" | "High" | "Critical"; status: string }> = {}) {
  return {
    id: 1,
    aiGeneratedAt: null,
    severity: "High" as const,
    status: "Open",
    ...overrides,
  };
}

describe("queueSiemAiAnalysis", () => {
  it("enqueues a job when finding is High severity, AI is enabled, and no analysis exists", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ aiEnabled: true }]));
    const inserted: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAiAnalysis(makeFinding({ id: 42, severity: "High" }));
    expect(result).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ findingId: 42, status: "pending", attempts: 0 });
  });

  it("enqueues a job for Critical severity", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ aiEnabled: true }]));
    const inserted: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAiAnalysis(makeFinding({ severity: "Critical" }));
    expect(result).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it("skips when AI is disabled in settings", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ aiEnabled: false }]));
    const insertMock = vi.fn();
    mockedDb.insert.mockImplementation(() => ({ values: insertMock }));

    const result = await queueSiemAiAnalysis(makeFinding({ severity: "High" }));
    expect(result).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips when severity is Medium", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ aiEnabled: true }]));
    const insertMock = vi.fn();
    mockedDb.insert.mockImplementation(() => ({ values: insertMock }));

    const result = await queueSiemAiAnalysis(makeFinding({ severity: "Medium" }));
    expect(result).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips when aiGeneratedAt is within the 1h cooldown", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ aiEnabled: true }]));
    const insertMock = vi.fn();
    mockedDb.insert.mockImplementation(() => ({ values: insertMock }));

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const result = await queueSiemAiAnalysis(makeFinding({ severity: "Critical", aiGeneratedAt: tenMinutesAgo }));
    expect(result).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("runSiemAiWorkerOnce", () => {
  it("returns zeros when there are no pending jobs", async () => {
    mockedDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await runSiemAiWorkerOnce();
    expect(result).toEqual({ processed: 0, completed: 0, failed: 0 });
  });
});

// Reference symbols so they don't get flagged as unused by tooling.
void siemAiJobs;
void siemSettings;
void siemFindings;
