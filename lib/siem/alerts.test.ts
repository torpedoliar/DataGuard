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
  resolveSiteTelegramRecipients,
} from "./alerts";
import { siemAlerts, siemFindings, siemSettings, siteTelegramChatIds } from "../../db/schema";

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

// Chain for site_telegram_chat_ids: select({...}).from(siteTelegramChatIds).where(pred) → rows
function makeSelectFromWhere(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
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
    // Recipient resolver: 1 chat, all severities
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([{ chatId: "123", severityFilter: null, enabled: true }]));

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

  it("inserts one alert per recipient when site has multiple enabled chat rows (multi-recipient)", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding({ severity: "Critical" })]);
    // Two enabled chats, no severity filter → both receive
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([
      { chatId: "ops-1", severityFilter: null, enabled: true },
      { chatId: "sec-1", severityFilter: null, enabled: true },
    ]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemTelegramAlerts();

    expect(result.queued).toBe(2);
    expect(insertedValues).toHaveLength(2);
    const recipients = insertedValues.map((v) => (v as { recipient: string }).recipient).sort();
    expect(recipients).toEqual(["ops-1", "sec-1"]);
    for (const v of insertedValues) {
      expect(v).toMatchObject({ channel: "telegram", status: "pending", findingId: 1 });
    }
  });

  it("filters recipients by severity_filter (one matches, one does not)", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding({ severity: "Critical" })]);
    // Chat A: filter "High,Critical" → matches Critical
    // Chat B: filter "Low,Medium"    → does not match Critical
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([
      { chatId: "ops-hc", severityFilter: "High,Critical", enabled: true },
      { chatId: "mgmt-lm", severityFilter: "Low,Medium", enabled: true },
    ]));

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
    expect(insertedValues[0]).toMatchObject({ channel: "telegram", recipient: "ops-hc" });
  });

  it("falls back to legacy sites.telegramChatId when site_telegram_chat_ids is empty", async () => {
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ site: { id: 10, name: "DC-JKT", telegramChatId: "legacy-99" } }),
    ]);
    // No rows in multi-recipient table
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemTelegramAlerts();
    expect(result.queued).toBe(1);
    expect(insertedValues[0]).toMatchObject({ recipient: "legacy-99" });
  });
});

describe("resolveSiteTelegramRecipients", () => {
  it("returns empty list when no rows and no legacy chat id", async () => {
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    const out = await resolveSiteTelegramRecipients(10, "High", null);
    expect(out).toEqual([]);
  });

  it("returns legacy chat id when multi-recipient table is empty", async () => {
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    const out = await resolveSiteTelegramRecipients(10, "High", "legacy-1");
    expect(out).toEqual([{ chatId: "legacy-1", severityFilter: null }]);
  });

  it("drops disabled rows and rows whose filter does not include severity", async () => {
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([
      { chatId: "a", severityFilter: "High,Critical", enabled: true },
      { chatId: "b", severityFilter: "Low,Medium", enabled: true },
      { chatId: "c", severityFilter: null, enabled: false },
    ]));
    const out = await resolveSiteTelegramRecipients(10, "Critical", "ignored");
    expect(out.map((r) => r.chatId).sort()).toEqual(["a"]);
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
void siteTelegramChatIds;
