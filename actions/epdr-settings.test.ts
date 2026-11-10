import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  logAudit: vi.fn(async (): Promise<unknown> => undefined),
  revalidatePath: vi.fn(() => undefined),
  selectQueue: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: () => mocks.requireActiveSiteAdminAction(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: () => mocks.logAudit() }));
vi.mock("next/cache", () => ({ revalidatePath: () => mocks.revalidatePath() }));

vi.mock("@/db", () => {
  function thenable(value: () => unknown[]) {
    const t: Record<string, unknown> = { then: (fn: (v: unknown[]) => unknown) => Promise.resolve(value()).then(fn) };
    for (const m of ["where", "limit"] as const) t[m] = () => t;
    return t;
  }
  return {
    db: {
      select: (..._a: unknown[]) => ({ from: () => thenable(() => mocks.selectQueue.shift() ?? []) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => { mocks.inserts.push(v); return { onConflictDoUpdate: () => Promise.resolve(undefined) }; },
      }),
    },
  };
});

import { getEpdrSettings, saveEpdrSettings } from "./epdr-settings";

function form(values: Record<string, string | number | boolean>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === true) fd.append(k, "on");
    else if (v === false) void 0;
    else fd.append(k, String(v));
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.inserts = [];
  mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 });
});

describe("epdr-settings authorization", () => {
  it("rejects staff (site admin required)", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValueOnce({ ok: false, message: "Unauthorized." });
    const result = await saveEpdrSettings(undefined, form({ ingestEnabled: true }));
    expect(result).toMatchObject({ message: expect.stringContaining("Unauthorized") });
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe("epdr-settings validation", () => {
  it("rejects min score greater than max score", async () => {
    const result = await saveEpdrSettings(undefined, form({ ingestEnabled: true, threatsyncMinScore: 9, threatsyncMaxScore: 7 }));
    expect(result).toMatchObject({ message: expect.stringContaining("tidak boleh melebihi") });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("persists valid settings with normalized categories", async () => {
    const result = await saveEpdrSettings(undefined, form({
      ingestEnabled: true,
      eventTypes: "1,2,4,6,18",
      threatsyncEnabled: true,
      threatsyncCategories: "Malware, PUP, virus, exploit, ioa",
      threatsyncMinScore: 7,
      threatsyncMaxScore: 10,
      correlationWindowMinutes: 1440,
      reopenWindowDays: 7,
      siteKillSwitch: false,
    }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.inserts[0]).toMatchObject({
      siteId: 7,
      ingestEnabled: true,
      threatsyncCategories: ["malware", "pup", "virus", "exploit", "ioa"],
    });
  });
});

describe("getEpdrSettings", () => {
  it("applies defaults when no row exists", async () => {
    mocks.selectQueue = [[]];
    const result = await getEpdrSettings();
    expect(result).toMatchObject({
      ingestEnabled: false,
      threatsyncMinScore: 7,
      threatsyncMaxScore: 10,
      eventTypes: [1, 2, 4, 6, 18],
    });
  });
});