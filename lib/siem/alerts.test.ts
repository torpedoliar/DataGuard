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

// Keep the real escapeTelegramHtml (the message-level escaping under
// test) while mocking only the network sender.
vi.mock("../telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../telegram")>();
  return { ...actual, sendTelegramAlert: vi.fn() };
});

vi.mock("../ui/datetime", () => ({
  formatWibForAlert: (d: Date) => d.toISOString(),
}));

vi.mock("./redaction", () => ({
  redactSensitiveText: (s: string) => s,
}));

import { db } from "../../db";
import { sendTelegramAlert } from "../telegram";
import {
  queueSiemAlerts,
  sendPendingSiemAlerts,
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
  title: string;
  summary: string;
  rule: { alertEnabled: boolean } | null;
  site: { id: number; name: string; telegramChatId: string | null } | null;
  device: { id: number; name: string } | null;
  source: { id: number; sourceIp: string } | null;
  alerts: { channel: string; recipient?: string; status?: string }[];
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

// Chain: select().from(siemSettings).where(pred).limit(1) → rows
function makeSettingsChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, limit };
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

describe("queueSiemAlerts", () => {
  it("only inserts channel='telegram' rows when alert is eligible", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding()]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    // Recipient resolver: 1 chat, all severities
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([{ chatId: "123", severityFilter: null, enabled: true }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();

    expect(result.queued).toBe(1);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ channel: "telegram", status: "pending" });
  });

  it("does not insert when a telegram alert already exists on the finding", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ alerts: [{ channel: "telegram", recipient: "123" }] }),
    ]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([{ chatId: "123", severityFilter: null, enabled: true }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();
    expect(result.queued).toBe(0);
    expect(insertedValues).toHaveLength(0);
  });

  it("re-queues a permanently failed alert (failed rows do not block the queue)", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ alerts: [{ channel: "telegram", recipient: "123", status: "failed" }] }),
    ]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([{ chatId: "123", severityFilter: null, enabled: true }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();

    expect(result.queued).toBe(1);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      channel: "telegram",
      recipient: "123",
      status: "pending",
    });
  });

  it("does not insert when severity is below the configured alertMinSeverity", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding({ severity: "High" })]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "Critical" }]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();
    expect(result.queued).toBe(0);
    expect(insertedValues).toHaveLength(0);
  });

  it("inserts one alert per recipient when site has multiple enabled chat rows (multi-recipient)", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding({ severity: "Critical" })]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    // Two enabled chats, no severity filter → both receive
    mockedDb.select.mockReturnValueOnce(
      makeSelectFromWhere([
        { chatId: "100", severityFilter: null, enabled: true },
        { chatId: "200", severityFilter: null, enabled: true },
      ]),
    );
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();

    expect(result.queued).toBe(2);
    expect(insertedValues).toHaveLength(2);
    const recipients = insertedValues.map((v) => (v as { recipient: string }).recipient).sort();
    expect(recipients).toEqual(["100", "200"]);
    for (const v of insertedValues) {
      expect(v).toMatchObject({ channel: "telegram", status: "pending", findingId: 1 });
    }
  });

  it("filters recipients by severity_filter (one matches, one does not)", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([makeFinding({ severity: "Critical" })]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    // Chat A: filter "High,Critical" → matches Critical
    // Chat B: filter "Low,Medium"    → does not match Critical
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([
      { chatId: "ops-hc", severityFilter: "High,Critical", enabled: true },
      { chatId: "mgmt-lm", severityFilter: "Low,Medium", enabled: true },
    ]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();

    expect(result.queued).toBe(1);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ channel: "telegram", recipient: "ops-hc" });
  });

  it("falls back to legacy sites.telegramChatId when site_telegram_chat_ids is empty", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ site: { id: 10, name: "DC-JKT", telegramChatId: "legacy-99" } }),
    ]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    // No rows in multi-recipient table
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();
    expect(result.queued).toBe(1);
    expect(insertedValues[0]).toMatchObject({ recipient: "legacy-99" });
  });

  it("deep-links to the triggering severity, not a hardcoded High", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ severity: "Critical" }),
    ]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([{ chatId: "123", severityFilter: null, enabled: true }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();

    expect(result.queued).toBe(1);
    const message = (insertedValues[0] as { message: string }).message;
    expect(message).toContain("/admin/siem/findings?severity=Critical");
    expect(message).not.toContain("severity=High");
    // Deep link carries the finding id and its site so the page scrolls to
    // this row even from another site (& is HTML-escaped to &amp;).
    expect(message).toContain("&amp;site=10&amp;highlight=1");
  });

  it("HTML-escapes entity fields but keeps the SIEM deep link as an anchor (#58)", async () => {
    mockedDb.query.siemFindings.findMany.mockResolvedValueOnce([
      makeFinding({ severity: "Critical", title: "Port <b>[down]</b> & \"warn\"", summary: "summary *with* <chars>" }),
    ]);
    mockedDb.select.mockReturnValueOnce(makeSettingsChain([{ alertMinSeverity: "High" }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([{ chatId: "123", severityFilter: null, enabled: true }]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));
    mockedDb.select.mockReturnValueOnce(makeSelectFromWhere([]));

    const insertedValues: unknown[] = [];
    mockedDb.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }));

    const result = await queueSiemAlerts();

    expect(result.queued).toBe(1);
    const message = (insertedValues[0] as { message: string }).message;
    // Entity content HTML-escaped: < -> &lt;, > -> &gt;, & -> &amp;, " -> &quot;;
    // a stray entity cannot close a tag we opened (#75 superseded by #58).
    expect(message).toContain("Finding: #1 Port &lt;b&gt;[down]&lt;/b&gt; &amp; &quot;warn&quot;");
    expect(message).toContain("Summary: summary *with* &lt;chars&gt;");
    // The generated link survives unescaped and clickable as an anchor.
    expect(message).toContain("<a href=\"");
    expect(message).toContain("/admin/siem/findings?severity=Critical");
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
    expect(out).toEqual([{ recipient: "legacy-1", severityFilter: null }]);
  });

  it("drops disabled rows and rows whose filter does not include severity", async () => {
    mockedDb.select.mockReturnValueOnce(
      makeSelectFromWhere([
        { chatId: "a", severityFilter: "High,Critical", enabled: true },
        { chatId: "b", severityFilter: "Low,Medium", enabled: true },
        { chatId: "c", severityFilter: null, enabled: false },
      ]),
    );
    const out = await resolveSiteTelegramRecipients(10, "Critical", "ignored");
    expect(out.map((r) => r.recipient).sort()).toEqual(["a"]);
  });
});

describe("sendPendingSiemAlerts", () => {
  it("queries by status='pending' then dispatches via channel sender", async () => {
    const rows = [
      { id: 1, channel: "telegram", recipient: "100", message: "m1" },
      { id: 2, channel: "telegram", recipient: "200", message: "m2" },
    ];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());

    mockedSend.mockResolvedValue({ success: true, message: "ok" });
    const updateWhere = vi.fn().mockReturnValue(Promise.resolve());
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockedDb.update.mockReturnValue({ set: updateSet });

    const result = await sendPendingSiemAlerts();

    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend).toHaveBeenNthCalledWith(1, "100", "m1");
    expect(mockedSend).toHaveBeenNthCalledWith(2, "200", "m2");
    expect(chain.from).toHaveBeenCalledWith(siemAlerts);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("increments retryCount when send returns success=false", async () => {
    const rows = [{ id: 7, channel: "telegram", recipient: "x", message: "m", retryCount: 0 }];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());
    mockedSend.mockResolvedValue({ success: false, message: "boom" });
    const updateWhere = vi.fn().mockReturnValue(Promise.resolve());
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockedDb.update.mockReturnValue({ set: updateSet });

    const result = await sendPendingSiemAlerts();

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ retryCount: 1, error: "boom" }),
    );
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("skips a retried alert until its exponential backoff window elapses", async () => {
    const rows = [{
      id: 9,
      channel: "telegram",
      recipient: "x",
      message: "m",
      retryCount: 1,
      // 10s < 2^1 * 15s → not yet eligible
      createdAt: new Date(Date.now() - 10_000),
    }];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());

    const result = await sendPendingSiemAlerts();

    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedDb.update).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("retries once the backoff window has elapsed", async () => {
    const rows = [{
      id: 10,
      channel: "telegram",
      recipient: "x",
      message: "m",
      retryCount: 1,
      // 35s > 30s window → eligible again
      createdAt: new Date(Date.now() - 35_000),
    }];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());
    mockedSend.mockResolvedValue({ success: false, message: "still down" });
    const updateWhere = vi.fn().mockReturnValue(Promise.resolve());
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockedDb.update.mockReturnValue({ set: updateSet });

    const result = await sendPendingSiemAlerts();

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ retryCount: 2, error: "still down" }),
    );
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("marks the row failed once retries are exhausted so the queue can re-queue it", async () => {
    const rows = [{
      id: 11,
      channel: "telegram",
      recipient: "x",
      message: "m",
      retryCount: 4, // MAX_SEND_RETRIES
      createdAt: new Date(Date.now() - 5 * 60_000),
    }];
    const chain = makeSelectFromWhereLimitChain(rows);
    mockedDb.select.mockReturnValueOnce(chain.select());
    mockedSend.mockResolvedValue({ success: false, message: "permanently down" });
    const updateWhere = vi.fn().mockReturnValue(Promise.resolve());
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockedDb.update.mockReturnValue({ set: updateSet });

    const result = await sendPendingSiemAlerts();

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "permanently down" }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ retryCount: 5 }));
    expect(result).toEqual({ sent: 0, failed: 1 });
  });
});

// Reference symbols so they don't get flagged as unused by tooling.
void siemSettings;
void siemFindings;
void siemAlerts;
void siteTelegramChatIds;
