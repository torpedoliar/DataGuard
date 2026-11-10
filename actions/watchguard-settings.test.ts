import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(async (..._args: unknown[]) => ({ userId: 1, username: "root", role: "superadmin" })),
  logAudit: vi.fn(async (..._args: unknown[]) => undefined),
  revalidatePath: vi.fn((..._args: unknown[]) => undefined),
  testConnection: vi.fn(async (..._args: unknown[]) => ({ configured: true, read: {} })),
  selectQueue: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  encryptString: (s: string) => `enc(${s})`,
}));

vi.mock("../lib/session", () => ({
  verifySession: (...args: unknown[]) => mocks.verifySession(...args),
}));

vi.mock("../lib/audit", () => ({
  logAudit: (...args: unknown[]) => mocks.logAudit(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args),
}));

vi.mock("../lib/crypto", () => ({
  encryptString: (s: string) => mocks.encryptString(s),
}));

vi.mock("../lib/watchguard/connection", () => ({
  testConnection: (...args: unknown[]) => mocks.testConnection(...args),
}));

vi.mock("../db", () => {
  function thenable(value: () => unknown[]) {
    const t: Record<string, unknown> = {
      then: (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(value()).then(onFulfilled),
    };
    for (const method of ["where", "orderBy", "limit"] as const) {
      t[method] = () => t;
    }
    return t;
  }
  return {
    db: {
      select: (..._args: unknown[]) => ({ from: () => thenable(() => mocks.selectQueue.shift() ?? []) }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          mocks.updates.push(v);
          return { where: () => Promise.resolve(undefined) };
        },
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          mocks.inserts.push(v);
          return Promise.resolve(undefined);
        },
      }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    },
  };
});

import { clearWatchGuardSecrets, saveWatchGuardConnection, saveWatchGuardGlobal, testWatchGuardConnection } from "./watchguard-settings";

function form(values: Record<string, string | number | boolean | readonly string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === true) fd.append(key, "on");
    else if (value === false) void 0;
    else if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else fd.append(key, String(value));
  }
  return fd;
}

function saveForm(overrides: Record<string, string | number | boolean> = {}): FormData {
  return form({
    watchguardSiteId: "1",
    watchguardEnabled: false,
    watchguardRegion: "jpn",
    watchguardAccountId: "WGC-3-123",
    watchguardApiKey: "",
    watchguardRwAccessId: "ACCESS-RW",
    watchguardRwPassword: "",
    watchguardRoAccessId: "",
    watchguardRoPassword: "",
    watchguardEndpointSyncMinutes: 15,
    watchguardDetectionSyncMinutes: 5,
    ...overrides,
  });
}

function existingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    siteId: 1,
    enabled: false,
    region: "jpn",
    accountId: "WGC-3-123",
    apiKey: "enc(old-key)",
    rwAccessId: "ACCESS-RW",
    rwPassword: "enc(old-pass)",
    roAccessId: null,
    roPassword: null,
    endpointSyncMinutes: 15,
    detectionSyncMinutes: 5,
    credentialRevision: 2,
    accountRevision: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.updates = [];
  mocks.inserts = [];
  mocks.verifySession.mockResolvedValue({ userId: 1, username: "root", role: "superadmin" });
  mocks.testConnection.mockResolvedValue({ configured: true, read: {} });
});

describe("authorization", () => {
  it("rejects non-superadmin for every action without touching the DB", async () => {
    mocks.verifySession.mockResolvedValueOnce({ userId: 2, username: "op", role: "admin" });

    const save = await saveWatchGuardConnection(undefined, saveForm());
    expect(save).toMatchObject({ message: expect.stringContaining("Unauthorized") });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);

    mocks.verifySession.mockResolvedValueOnce({ userId: 2, username: "op", role: "admin" });
    const global = await saveWatchGuardGlobal(undefined, form({ watchguardKillSwitch: true, watchguardAllowedActions: ["scan"], watchguardMaxActionsPerHour: 30 }));
    expect(global).toMatchObject({ message: expect.stringContaining("Unauthorized") });
  });
});

describe("saveWatchGuardConnection validation", () => {
  it("rejects an unknown region", async () => {
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardRegion: "eu" }));
    expect(result).toMatchObject({ message: expect.stringContaining("Region") });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("rejects an out-of-range endpoint interval", async () => {
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardEndpointSyncMinutes: 3 }));
    expect(result).toMatchObject({ message: expect.stringContaining("Interval") });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("rejects an out-of-range detection interval", async () => {
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardDetectionSyncMinutes: 100 }));
    expect(result).toMatchObject({ message: expect.stringContaining("Interval") });
  });

  it("rejects a duplicate region/account binding on another site", async () => {
    // clash query returns a row, existing query returns []
    mocks.selectQueue = [[{ id: 9 }], []];
    const result = await saveWatchGuardConnection(undefined, saveForm());
    expect(result).toMatchObject({ message: expect.stringContaining("sudah dipakai site lain") });
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe("saveWatchGuardConnection persistence", () => {
  it("preserves stored secrets when the secret fields are blank", async () => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm());
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({
      apiKey: "enc(old-key)",
      rwPassword: "enc(old-pass)",
      credentialRevision: 2,
      accountRevision: 1,
    });
  });

  it("rotates credentials (bumps credential_revision) when a new secret is supplied", async () => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardApiKey: "brand-new" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({
      apiKey: "enc(brand-new)",
      credentialRevision: 3,
    });
  });

  it("bumps account_revision when the region/account changes", async () => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardAccountId: "WGC-3-999" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ accountRevision: 2 });
  });

  it("never leaks a plaintext secret into audit or result", async () => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardRwPassword: "super-secret-pw" }));
    const auditAndResult = JSON.stringify(result) + JSON.stringify(mocks.logAudit.mock.calls);
    expect(auditAndResult).not.toContain("super-secret-pw");
    // The stored value is the encrypted envelope, not the raw plaintext.
    expect(mocks.updates[0]).toMatchObject({ rwPassword: "enc(super-secret-pw)" });
    expect(mocks.updates[0]!.rwPassword).not.toBe("super-secret-pw");
  });
});

describe("testWatchGuardConnection action", () => {
  it("persists the per-service result", async () => {
    mocks.selectQueue = [
      [existingRow()], // the connection row look-up
    ];
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: "1" }));
    expect(mocks.testConnection).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({ ok: true });
    expect(mocks.updates[0]).toMatchObject({ lastTestAt: expect.any(Date) });
  });

  it("tells the operator to save a draft first when no row exists", async () => {
    mocks.selectQueue = [[]];
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: "1" }));
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("simpan dulu") });
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });
});

describe("clearWatchGuardSecrets action", () => {
  it("nulls secrets and bumps the credential revision", async () => {
    mocks.selectQueue = [[existingRow()]];
    const result = await clearWatchGuardSecrets(undefined, form({ watchguardSiteId: "1" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ apiKey: null, rwPassword: null, roPassword: null, credentialRevision: 3 });
  });
});