import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db, telegram, datetime, and redaction modules before importing the SUT.
vi.mock("../../db", () => {
  return {
    db: {
      select: vi.fn(),
      query: {
        siemFindings: {
          findMany: vi.fn(),
        },
      },
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("../telegram", () => ({
  sendTelegramAlert: vi.fn(),
}));

vi.mock("../ui/datetime", () => ({
  formatWibForAlert: (d: Date) => d.toISOString(),
}));

vi.mock("./redaction", () => ({
  redactSensitiveText: (s: string) => s,
}));

import { db } from "../../db";
import { sendTelegramAlert } from "../telegram";
import {
  queueSiemTelegramAlerts,
  sendPendingSiemTelegramAlerts,
} from "./alerts";
import { siemAlerts, siemFindings, siemSettings } from "../../db/schema";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  query: { siemFindings: { findMany: ReturnType<typeof vi.fn> } };
};
const mockedSend = sendTelegramAlert as unknown as ReturnType<typeof vi.fn>;

type FindingOverrides = Partial<{
  id: number;
  severity: "Low" | "Medium" | "High" | "Critical";
  rule: { alertEnabled: boolean } | null;
  site: { id: number; name: string; telegramChatId: string | null } | null;
  device: { id: number; name: string } | null;
  source: { id: number; sourceIp: string } | null;
  alerts: { channel: string }[];
}>;

function makeFinding(overrides: FindingOverrides = {}) {
  return {
    id: 1,
    severity: "High" as const,
    rule: { alertEnabled: true },
    site: { id: 10, name: "DC-JKT", telegramChatId: "123" },
    device: { id: 20, name: "fw-01" },
    source: { id: 30, sourceIp: "10.0.0.5" },
    alerts: [],
    title: "t",
    summary: "s",
    humanAnalysis: null,
    recommendedAction: null,
    lastSeenAt: new Date("2026-06-14T00:00:00.000Z"),
    status: "Open" as const,
    ...overrides,
  };
}

// Chain: select(<args?>).from(siemAlerts).where(<pred>).limit(25) → rows
function makeSelectFromWhereLimitChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, limit };
}

// Chain: select().from(siemSettings).limit(1) → rows
function makeSettingsChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, limit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("queueSiemTelegramAlerts", () => {
  it("only inserts channel='telegram' rows when alert is eligible", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding()]);

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemTelegramAlerts();

    expect(result.queued).toBe(1);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ channel: "telegram", status: "pending" });
  });

  it("does not insert when a telegram alert already exists on the finding", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ alerts: [{ channel: "telegram" }] }),
    ]);

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemTelegramAlerts();
    expect(result.queued).toBe(0);
    expect(insertedValues).toHaveLength(0);
  });

  it("does not insert when severity is below the configured alertMinSeverity", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "Critical" }]));
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding({ severity: "High" })]);

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemTelegramAlerts();
    expect(result.queued).toBe(0);
    expect(insertedValues).toHaveLength(0);
  });
});

describe("sendPendingSiemTelegramAlerts", () => {
  it("queries by channel='telegram' and status='pending' then dispatches via sendTelegramAlert", async () => {
    const rows = [
      { id: 1, recipient: "100", message: "m1" },
      { id: 2, recipient: "200", message: "m2" },
    ];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());

    mockedSend.mockResolvedValue({ success: true, message: "ok" });
    const updateWhere = vi.fn().mockReturnValue(Promise.resolve());
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockedDb.update.mockReturnValue({ set: updateSet });

    const result = await sendPendingSiemTelegramAlerts();

    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend).toHaveBeenNthCalledWith(1, "100", "m1");
    expect(mockedSend).toHaveBeenNthCalledWith(2, "200", "m2");
    expect(chain.from).toHaveBeenCalledWith(siemAlerts);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("marks alerts failed (and does not retry) when sendTelegramAlert returns success=false", async () => {
    const rows = [{ id: 7, recipient: "x", message: "m" }];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());
    mockedSend.mockResolvedValue({ success: false, message: "boom" });
    const updateWhere = vi.fn().mockReturnValue(Promise.resolve());
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockedDb.update.mockReturnValue({ set: updateSet });

    const result = await sendPendingSiemTelegramAlerts();

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "boom" }),
    );
    expect(result).toEqual({ sent: 0, failed: 1 });
  });
});

// Reference symbols so they don't get flagged as unused by tooling.
void siemSettings;
void siemFindings;
void siemAlerts;
