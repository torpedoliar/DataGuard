import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { ConnectionTestResult, ServiceChecks, ServiceTest } from "@/lib/watchguard/connection";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(async (..._args: unknown[]) => ({ userId: 1, username: "root", role: "superadmin" })),
  logAudit: vi.fn(async (..._args: unknown[]) => undefined),
  revalidatePath: vi.fn((..._args: unknown[]) => undefined),
  testConnection: vi.fn(async (..._args: unknown[]): Promise<ConnectionTestResult> => ({ configured: true, read: {} as ServiceChecks })),
  selectQueue: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  updateWhere: [] as SQL[],
  returnedUpdates: [{ id: 1 }] as Array<{ id: number }>,
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
          return {
            where: (condition: SQL) => {
              mocks.updateWhere.push(condition);
              return {
                then: (resolve: (value: undefined) => unknown) => Promise.resolve(undefined).then(resolve),
                returning: () => Promise.resolve(mocks.returnedUpdates),
              };
            },
          };
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
    watchguardRwAccessId: "",
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
  mocks.updateWhere = [];
  mocks.returnedUpdates = [{ id: 1 }];
  mocks.inserts = [];
  mocks.verifySession.mockResolvedValue({ userId: 1, username: "root", role: "superadmin" });
  mocks.testConnection.mockResolvedValue({ configured: true, read: {} as ServiceChecks });
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

describe("credential input safeguards", () => {
  const credentialFields = ["watchguardApiKey", "watchguardRoAccessId", "watchguardRoPassword", "watchguardRwAccessId", "watchguardRwPassword"];

  it.each(credentialFields.flatMap((field) => ["********", "••••••••", "●●●●●●●●", "  ********  "].map((mask) => ({ field, mask }))))(
    "rejects a mask sentinel in $field without persisting or rotating", async ({ field, mask }) => {
      mocks.selectQueue = [[], [existingRow()]];
      const result = await saveWatchGuardConnection(undefined, saveForm({ [field]: mask, watchguardApiKey: field === "watchguardApiKey" ? mask : "replacement-key" }));
      expect(result).not.toHaveProperty("success");
      expect(mocks.updates).toHaveLength(0);
      expect(mocks.inserts).toHaveLength(0);
      expect(mocks.logAudit).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.testConnection).not.toHaveBeenCalled();
    },
  );

  it.each(["Ro", "Rw"].flatMap((mode) => ["AccessId", "Password"].flatMap((part) => [false, true].map((newConnection) => ({ mode, part, newConnection })))))(
    "rejects partial $mode $part credentials (new connection: $newConnection)", async ({ mode, part, newConnection }) => {
      // An existing RW pair must not make a partial RO pair valid.
      mocks.selectQueue = [[], newConnection ? [] : [existingRow({ [`${mode.toLowerCase()}AccessId`]: null, [`${mode.toLowerCase()}Password`]: null })]];
      const result = await saveWatchGuardConnection(undefined, saveForm({ [`watchguard${mode}${part}`]: "partial-value", watchguardApiKey: "replacement-key" }));
      expect(result).not.toHaveProperty("success");
      expect(mocks.updates).toHaveLength(0);
      expect(mocks.inserts).toHaveLength(0);
      expect(mocks.logAudit).not.toHaveBeenCalled();
      expect(mocks.testConnection).not.toHaveBeenCalled();
    },
  );

  it("allows a new draft with both credential pairs absent", async () => {
    mocks.selectQueue = [[], []];
    const result = await saveWatchGuardConnection(undefined, saveForm());
    expect(result).toMatchObject({ success: true });
    expect(mocks.inserts[0]).toMatchObject({ rwAccessId: null, rwPassword: null, roAccessId: null, roPassword: null });
  });
});

describe("saveWatchGuardConnection persistence", () => {
  it("preserves both stored IDs, secrets and revisions on an unchanged wizard submit", async () => {
    mocks.selectQueue = [[], [existingRow({ roAccessId: "ACCESS-RO", roPassword: "enc(old-ro-pass)" })]];
    const result = await saveWatchGuardConnection(undefined, saveForm());
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({
      apiKey: "enc(old-key)",
      rwAccessId: "ACCESS-RW",
      rwPassword: "enc(old-pass)",
      roAccessId: "ACCESS-RO",
      roPassword: "enc(old-ro-pass)",
      credentialRevision: 2,
      accountRevision: 1,
    });
  });

  it("preserves credentials when only sync settings change", async () => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardEndpointSyncMinutes: 30 }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({
      endpointSyncMinutes: 30, rwAccessId: "ACCESS-RW", rwPassword: "enc(old-pass)", credentialRevision: 2,
    });
  });

  it.each(["Ro", "Rw"])("stores a legitimate %s credential replacement", async (mode) => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm({
      [`watchguard${mode}AccessId`]: "NEW-ACCESS",
      [`watchguard${mode}Password`]: "new-password",
    }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({
      [`${mode.toLowerCase()}AccessId`]: "NEW-ACCESS",
      [`${mode.toLowerCase()}Password`]: "enc(new-password)",
      credentialRevision: 3,
    });
  });

  it.each(["Ro", "Rw"])("requires a fresh password when the %s access ID changes", async (mode) => {
    mocks.selectQueue = [[], [existingRow({ roAccessId: "ACCESS-RO", roPassword: "enc(old-ro-pass)" })]];
    const result = await saveWatchGuardConnection(undefined, saveForm({ [`watchguard${mode}AccessId`]: "NEW-ID" }));
    expect(result).toMatchObject({ message: expect.stringContaining("Password baru") });
    expect(result).not.toHaveProperty("success");
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("does not rotate when the same access ID is explicitly supplied", async () => {
    mocks.selectQueue = [[], [existingRow()]];
    const result = await saveWatchGuardConnection(undefined, saveForm({ watchguardRwAccessId: "ACCESS-RW" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ credentialRevision: 2 });
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

describe("test result invalidation", () => {
  it.each([
    { watchguardAccountId: "NEW-ACCOUNT" },
    { watchguardRegion: "usa" },
    { watchguardApiKey: "new-key" },
    { watchguardRoAccessId: "NEW-RO", watchguardRoPassword: "new-ro-password" },
    { watchguardRwPassword: "new-rw-password" },
  ] as Array<Record<string, string>>)("invalidates a previous test after account or credential changes: %o", async (changes) => {
    mocks.selectQueue = [[], [existingRow({ lastTestAt: new Date(), lastTestResult: { configured: true } })]];
    const result = await saveWatchGuardConnection(undefined, saveForm(changes));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ lastTestAt: null, lastTestResult: null });
  });

  it("leaves existing tests untouched when credentials and account are unchanged", async () => {
    mocks.selectQueue = [[], [existingRow({ lastTestAt: new Date(), lastTestResult: { configured: true } })]];
    await saveWatchGuardConnection(undefined, saveForm({ watchguardEndpointSyncMinutes: 30, watchguardEnabled: true }));
    expect(mocks.updates[0]).not.toHaveProperty("lastTestAt");
    expect(mocks.updates[0]).not.toHaveProperty("lastTestResult");
  });
});

function serviceChecks(overrides: Partial<ServiceTest> = {}): ServiceChecks {
  const check: ServiceTest = { ok: true, status: 200, kind: null, message: "OK", stage: "rest", ...overrides };
  return { auth: { ...check, stage: "oauth" }, account: { ...check }, endpointSecurity: { ...check }, threatSync: { ...check } };
}

describe("testWatchGuardConnection diagnostics", () => {
  it("accepts successful RO-only checks while reporting missing RW and skipped resolve probes", async () => {
    mocks.selectQueue = [[existingRow()]];
    mocks.testConnection.mockResolvedValueOnce({
      configured: true, read: serviceChecks(),
      write: serviceChecks({ ok: false, status: null, kind: "unresolved", skipped: true, stage: "resolve" }),
      credentialSources: { read: "ro" }, unresolved: { write: "missing_write_credentials" },
    });
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: 1 }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("RO:source=RO");
    expect(result.message).toContain("RW:unresolved=missing_write_credentials");
    expect(result.message).toContain("RW:account=SKIPPED(stage=resolve, kind=unresolved)");
    expect(mocks.updates[0].lastTestResult).toMatchObject({ credentialSources: { read: "ro" }, unresolved: { write: "missing_write_credentials" } });
  });

  it("reports OAuth failure and skipped REST status without provider messages", async () => {
    mocks.selectQueue = [[existingRow()]];
    const checks = serviceChecks({ ok: false, status: 401, kind: "auth", message: "private provider password", skipped: true });
    checks.auth.skipped = false;
    mocks.testConnection.mockResolvedValueOnce({ configured: true, read: checks, credentialSources: { read: "rw" } });
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: 1 }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("RO:source=RW");
    expect(result.message).toContain("RO:auth=gagal(stage=oauth, HTTP 401, kind=auth)");
    expect(result.message).toContain("RO:account=SKIPPED(stage=rest, HTTP 401, kind=auth)");
    expect(result.message).not.toContain("private provider password");
  });

  it.each(["read", "write"] as const)("rejects unresolved %s credentials even with successful checks", async (mode) => {
    mocks.selectQueue = [[existingRow()]];
    mocks.testConnection.mockResolvedValueOnce({ configured: true, read: serviceChecks(), write: serviceChecks(), unresolved: { [mode]: "partial_read_credentials" } });
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: 1 }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unresolved=partial_read_credentials");
  });

  it("rejects skipped checks even if marked OK", async () => {
    mocks.selectQueue = [[existingRow()]];
    mocks.testConnection.mockResolvedValueOnce({ configured: true, read: serviceChecks({ skipped: true }) });
    expect((await testWatchGuardConnection(undefined, form({ watchguardSiteId: 1 }))).ok).toBe(false);
  });

  it("reports unconfigured resolution reasons", async () => {
    mocks.selectQueue = [[existingRow()]];
    mocks.testConnection.mockResolvedValueOnce({ configured: false, reason: "not_configured", unresolved: { read: "partial_read_credentials", write: "missing_write_credentials" } });
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: 1 }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("belum layak (not_configured)");
    expect(result.message).toContain("RO:unresolved=partial_read_credentials");
  });
});

describe("testWatchGuardConnection action", () => {
  it("persists the per-service result", async () => {
    mocks.selectQueue = [
      [existingRow()], // the connection row look-up
    ];
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: "1" }));
    expect(mocks.testConnection).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({ ok: true, testedCredentialRevision: 2, testedAccountRevision: 1 });
    expect(mocks.updates[0]).toMatchObject({
      lastTestAt: expect.any(Date),
      lastTestResult: { configured: true, read: {}, credentialRevision: 2, accountRevision: 1 },
    });
    const query = new PgDialect().sqlToQuery(mocks.updateWhere[0]);
    expect(query.sql).toContain('"credential_revision" =');
    expect(query.sql).toContain('"account_revision" =');
    expect(query.params).toEqual([1, 2, 1]);
  });

  it("rejects stale test results when either revision changed before persistence", async () => {
    mocks.selectQueue = [[existingRow()]];
    mocks.returnedUpdates = [];
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: "1" }));
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("berubah") });
    expect(result).not.toHaveProperty("testedCredentialRevision");
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("returns a safe error rather than exposing a thrown exception", async () => {
    mocks.selectQueue = [[existingRow()]];
    mocks.testConnection.mockRejectedValueOnce(new Error("private password and authorization header"));
    const result = await testWatchGuardConnection(undefined, form({ watchguardSiteId: "1" }));
    expect(result).toEqual({ ok: false, message: "Tes koneksi gagal. Silakan coba lagi." });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.logAudit).not.toHaveBeenCalled();
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
    expect(mocks.updates[0]).toMatchObject({
      enabled: false, apiKey: null, rwAccessId: null, rwPassword: null, roAccessId: null, roPassword: null,
      credentialRevision: 3, lastTestAt: null, lastTestResult: null,
    });
  });
});