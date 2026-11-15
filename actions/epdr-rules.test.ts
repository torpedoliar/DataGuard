import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  logAudit: vi.fn(async (): Promise<unknown> => undefined),
  revalidatePath: vi.fn(() => undefined),
  selectQueue: [] as unknown[][],
  executeQueue: [] as unknown[][],
  statements: [] as unknown[],
  failInsert: false,
  transactions: 0,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: () => mocks.requireActiveSiteAdminAction() }));
vi.mock("@/lib/audit", () => ({ logAudit: () => mocks.logAudit() }));
vi.mock("next/cache", () => ({ revalidatePath: () => mocks.revalidatePath() }));

vi.mock("@/db", () => {
  function thenable(value: () => unknown[]) {
    const t: Record<string, unknown> = { then: (fn: (v: unknown[]) => unknown) => Promise.resolve(value()).then(fn) };
    for (const m of ["where", "orderBy", "limit"] as const) t[m] = () => t;
    return t;
  }
  const db = {
      select: () => ({ from: () => thenable(() => mocks.selectQueue.shift() ?? []) }),
      update: () => ({ set: (v: Record<string, unknown>) => { mocks.updates.push(v); return { where: () => Promise.resolve(undefined) }; } }),
      insert: () => ({ values: (v: Record<string, unknown>) => {
        if (mocks.failInsert) return Promise.reject(new Error("insert failed"));
        mocks.inserts.push(v); return Promise.resolve(undefined);
      } }),
      execute: (statement: unknown) => {
        mocks.statements.push(statement);
        return Promise.resolve({ rows: mocks.executeQueue.shift() ?? [] });
      },
    };
  return { db: { ...db, transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
    mocks.transactions++;
    const updates = [...mocks.updates];
    const inserts = [...mocks.inserts];
    try { return await fn(db); } catch (error) {
      mocks.updates = updates;
      mocks.inserts = inserts;
      throw error;
    }
  } } };
});

import { confirmAutomaticMode, rejectAutomaticMode, requestAutomaticMode, saveEpdrRule } from "./epdr-rules";

function form(values: Record<string, string | number | boolean>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === true) fd.append(k, "on");
    else if (v === false) void 0;
    else fd.append(k, String(v));
  }
  return fd;
}

const saveForm = (overrides: Record<string, string | number | boolean> = {}) =>
  form({
    ruleKey: "00000000-0000-4000-8000-000000000001",
    name: "Scored scan",
    enabled: true,
    categories: "malware,pup,virus,exploit,ioa",
    minScore: "7",
    maxScore: "10",
    deviceTypes: "1,2",
    actionType: "scan",
    closeMode: "manual",
    observationMinutes: 30,
    cooldownMinutes: 240,
    priority: 100,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.executeQueue = [[{ id: 7 }], [{ role: "admin" }], [{ id: 1 }]];
  mocks.statements = [];
  mocks.failInsert = false;
  mocks.transactions = 0;
  mocks.updates = [];
  mocks.inserts = [];
  mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 });
});

describe("epdr-rules authorization", () => {
  it("rejects staff", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValueOnce({ ok: false, message: "Unauthorized." });
    const result = await saveEpdrRule(undefined, saveForm());
    expect(result).toMatchObject({ message: expect.stringContaining("Unauthorized") });
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe("epdr-rules versioning", () => {
  it("creates a new version and flips the previous current when editing", async () => {
    // latest version query for the existing rule key
    mocks.selectQueue = [[{ version: 3 }]];
    const result = await saveEpdrRule(undefined, saveForm());
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ isCurrent: false });
    expect(mocks.inserts[0]).toMatchObject({ version: 4, isCurrent: true, executionMode: "simulate" });
  });

  it("creates a new rule with version 1 and simulate mode", async () => {
    mocks.selectQueue = [[]];
    const result = await saveEpdrRule(undefined, saveForm({ ruleKey: "" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.inserts[0]).toMatchObject({ version: 1, executionMode: "simulate" });
  });
});

describe("epdr-rules READ_ONLY safeguard", () => {
  for (const [name, action] of [["request", requestAutomaticMode], ["confirm", confirmAutomaticMode]] as const) {
    for (const requester of [1, 2]) {
      it(`${name} cannot activate automatic mode even with admin ${requester} approval`, async () => {
        mocks.selectQueue = [[{ id: 9, version: 1, pendingMode: "automatic", pendingModeRequestedBy: requester,
          executionMode: "simulate", simulateSince: new Date(0) }]];
        const result = await action(undefined, form({ ruleKey: "k", rulesVersion: 1 }));
        expect(result).toMatchObject({ status: "blocked_read_only", message: expect.stringContaining("READ_ONLY") });
        expect(result).not.toHaveProperty("success", true);
        expect(mocks.updates).toHaveLength(0);
        expect(mocks.inserts).toHaveLength(0);
        expect(mocks.transactions).toBe(0);
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
      });
    }
    it(`${name} respects authorization and validates bounded keys`, async () => {
      mocks.requireActiveSiteAdminAction.mockResolvedValueOnce({ ok: false, message: "Unauthorized." });
      expect(await action(undefined, form({ ruleKey: "k", rulesVersion: 1 }))).toEqual({ message: "Unauthorized." });
      for (const key of [" ", "k".repeat(65)]) {
        expect(await action(undefined, form({ ruleKey: key, rulesVersion: 1 }))).toEqual({ message: "Input tidak valid." });
      }
    });
  }
});

describe("epdr-rules atomic publication and tenancy", () => {
  it("rolls back the current flip when inserting the replacement fails", async () => {
    mocks.selectQueue = [[{ version: 3 }]];
    mocks.failInsert = true;
    expect(await saveEpdrRule(undefined, saveForm())).not.toHaveProperty("success", true);
    expect(mocks.transactions).toBe(1);
    expect(mocks.updates).toEqual([]);
    expect(mocks.inserts).toEqual([]);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  for (const [name, queue] of [
    ["inactive site", [[]]],
    ["inactive actor", [[{ id: 7 }], []]],
    ["revoked membership", [[{ id: 7 }], [{ role: "admin" }], []]],
  ] as const) {
    it(`rejects ${name} inside the transaction before mutations`, async () => {
      mocks.executeQueue = queue.map(rows => [...rows]);
      mocks.selectQueue = [[{ version: 3 }]];
      expect(await saveEpdrRule(undefined, saveForm())).not.toHaveProperty("success", true);
      expect(mocks.updates).toEqual([]);
      expect(mocks.inserts).toEqual([]);
    });
  }

  it("does not publish a key absent from the active site", async () => {
    mocks.selectQueue = [[]];
    expect(await saveEpdrRule(undefined, saveForm())).not.toHaveProperty("success", true);
    expect(mocks.updates).toEqual([]);
    expect(mocks.inserts).toEqual([]);
  });

  it("locks site, actor and membership before publishing a site-owned version", async () => {
    mocks.selectQueue = [[{ version: 3 }]];
    expect(await saveEpdrRule(undefined, saveForm())).toHaveProperty("success", true);
    expect(mocks.statements).toHaveLength(3);
    expect(mocks.inserts[0]).toMatchObject({ siteId: 7, createdBy: 1, version: 4 });
  });

  it("allows a live superadmin without site membership", async () => {
    mocks.executeQueue = [[{ id: 7 }], [{ role: "superadmin" }]];
    expect(await saveEpdrRule(undefined, saveForm({ ruleKey: "" }))).toHaveProperty("success", true);
    expect(mocks.statements).toHaveLength(2);
  });

  it("rejects unknown categories and oversized keys before opening a transaction", async () => {
    const invalidInputs: Record<string, string>[] = [{ categories: "malware,unknown" }, { ruleKey: "k".repeat(65) }];
    for (const override of invalidInputs) {
      expect(await saveEpdrRule(undefined, saveForm(override))).not.toHaveProperty("success", true);
    }
    expect(mocks.transactions).toBe(0);
    expect(mocks.inserts).toEqual([]);
  });

  it("reject does not clear a stale version's pending request", async () => {
    mocks.selectQueue = [[{ id: 9, version: 2, pendingMode: "automatic" }]];
    expect(await rejectAutomaticMode(undefined, form({ ruleKey: "k", rulesVersion: 1 }))).not.toHaveProperty("success", true);
    expect(mocks.updates).toEqual([]);
  });
});
