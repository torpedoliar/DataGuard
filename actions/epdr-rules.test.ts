import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  logAudit: vi.fn(async (): Promise<unknown> => undefined),
  revalidatePath: vi.fn(() => undefined),
  selectQueue: [] as unknown[][],
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
  return {
    db: {
      select: (..._a: unknown[]) => ({ from: () => thenable(() => mocks.selectQueue.shift() ?? []) }),
      update: () => ({ set: (v: Record<string, unknown>) => { mocks.updates.push(v); return { where: () => Promise.resolve(undefined) }; } }),
      insert: () => ({ values: (v: Record<string, unknown>) => { mocks.inserts.push(v); return Promise.resolve(undefined); } }),
    },
  };
});

import { confirmAutomaticMode, requestAutomaticMode, saveEpdrRule } from "./epdr-rules";

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

describe("epdr-rules two-admin confirmation", () => {
  it("rejects self-confirmation", async () => {
    mocks.selectQueue = [[{ version: 1, pendingMode: "automatic", pendingModeRequestedBy: 1, executionMode: "simulate", simulateSince: new Date() }]];
    const result = await confirmAutomaticMode(undefined, form({ ruleKey: "k", rulesVersion: 1 }));
    expect(result).toMatchObject({ message: expect.stringContaining("sendiri") });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("confirms by a different admin creating a new automatic version", async () => {
    mocks.selectQueue = [[{ id: 9, version: 1, pendingMode: "automatic", pendingModeRequestedBy: 2, executionMode: "simulate", simulateSince: new Date(), name: "R", trigger: "detection", categories: ["malware"], minScore: 7, maxScore: 10, deviceTypes: [1, 2], actionType: "scan", actionParams: {}, closeMode: "manual", observationMinutes: 30, cooldownMinutes: 240, priority: 100, createdBy: 2 }]];
    const result = await confirmAutomaticMode(undefined, form({ ruleKey: "k", rulesVersion: 1 }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.inserts[0]).toMatchObject({ version: 2, executionMode: "automatic" });
  });

  it("request rejects a stale rule version", async () => {
    mocks.selectQueue = [[{ simulationMinDays: 7 }], [{ version: 5, executionMode: "simulate", simulateSince: new Date() }]];
    const result = await requestAutomaticMode(undefined, form({ ruleKey: "k", rulesVersion: 4 }));
    expect(result).toMatchObject({ message: expect.stringContaining("Versi aturan berubah") });
  });
});