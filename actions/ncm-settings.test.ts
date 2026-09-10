import { beforeEach, describe, expect, it, vi } from "vitest";

// Every mock is declared with rest args typed `unknown[]` so the wrappers in
// vi.mock(...) can forward calls without tsc complaining about arity.
const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(async (..._args: unknown[]) => ({ userId: 1, username: "root", role: "superadmin" })),
  logAudit: vi.fn(async (..._args: unknown[]) => undefined),
  revalidatePath: vi.fn((..._args: unknown[]) => undefined),
  selectExisting: vi.fn(async (..._args: unknown[]) => [{ adminApiKey: "enc-key", webhookSecret: "v1:old" }]),
  updateHook: vi.fn((..._args: unknown[]) => undefined),
  insertHook: vi.fn((..._args: unknown[]) => undefined),
  resolveNcmConfig: vi.fn(async (..._args: unknown[]) => ({ url: "http://10.0.0.9:9443", adminApiKey: "admin-key" })),
  setNcmWebhook: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  fetchNcmSwitches: vi.fn(async (..._args: unknown[]) => []),
  touchNcmLastSeen: vi.fn(async (..._args: unknown[]) => undefined),
  checkNcmSite: vi.fn(async (..._args: unknown[]) => ({
    siteId: 1, configured: true, ok: true, status: "online", missCount: 0,
    incidentId: null, incidentCreated: false, error: null,
  })),
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

// Thenable select: every query resolves to selectExisting's current value
// (getNcmSettings's two selects and saveNcmWebhook's existence check).
vi.mock("../db", () => {
  const from = () => {
    const thenable = {
      then: (onFulfilled: (value: unknown[]) => unknown) =>
        Promise.resolve(mocks.selectExisting()).then(onFulfilled),
      where: () => thenable,
      orderBy: () => thenable,
    };
    return thenable;
  };
  const update = () => {
    mocks.updateHook();
    return { set: () => ({ where: () => Promise.resolve(undefined) }) };
  };
  const insert = () => ({ values: () => { mocks.insertHook(); return Promise.resolve(undefined); } });
  const del = () => ({ where: () => Promise.resolve(undefined) });
  return { db: { select: () => ({ from }), update, insert, delete: del } };
});

vi.mock("../lib/ncm", () => ({
  resolveNcmConfig: (...args: unknown[]) => mocks.resolveNcmConfig(...args),
  setNcmWebhook: (...args: unknown[]) => mocks.setNcmWebhook(...args),
  fetchNcmSwitches: (...args: unknown[]) => mocks.fetchNcmSwitches(...args),
  touchNcmLastSeen: (...args: unknown[]) => mocks.touchNcmLastSeen(...args),
}));

vi.mock("../lib/ncm-heartbeat", () => ({
  checkNcmSite: (...args: unknown[]) => mocks.checkNcmSite(...args),
  NCM_OFFLINE_THRESHOLD: 3,
  ncmHeartbeatDeps: {},
}));

const ENCRYPT_PREFIX = "v1:";
vi.mock("../lib/crypto", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/crypto")>();
  return {
    ...mod,
    encryptString: (plaintext: string) => `${ENCRYPT_PREFIX}enc(${plaintext})`,
    decryptIfEncrypted: (value: unknown) =>
      typeof value === "string" && value.startsWith(ENCRYPT_PREFIX) ? "stored-secret" : (value ?? null),
  };
});

import { saveNcmWebhook, checkNcmNow } from "./ncm-settings";

function form(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, String(value));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({ userId: 1, username: "root", role: "superadmin" });
  mocks.selectExisting.mockResolvedValue([{ adminApiKey: "enc-key", webhookSecret: "v1:old" }]);
  mocks.resolveNcmConfig.mockResolvedValue({ url: "http://10.0.0.9:9443", adminApiKey: "admin-key" });
  mocks.setNcmWebhook.mockResolvedValue({ ok: true });
  process.env.AI_KEY_ENCRYPTION_SECRET = "test-encryption-secret-that-is-long-enough-32";
});

describe("saveNcmWebhook (ticket 08)", () => {
  it("rejects non-superadmin before touching NCM or the DB", async () => {
    mocks.verifySession.mockResolvedValueOnce({ userId: 2, username: "op", role: "admin" });

    const result = await saveNcmWebhook(undefined, form({ ncmSiteId: "1", ncmWebhookUrl: "https://dg/x", ncmWebhookSecret: "s" }));

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Unauthorized") });
    expect(mocks.setNcmWebhook).not.toHaveBeenCalled();
    expect(mocks.updateHook).not.toHaveBeenCalled();
  });

  it("rejects a non-http webhook URL before writing", async () => {
    const result = await saveNcmWebhook(undefined, form({ ncmSiteId: "1", ncmWebhookUrl: "gopher://x", ncmWebhookSecret: "s" }));

    expect(result).toMatchObject({ ok: false, message: expect.any(String) });
    expect(mocks.setNcmWebhook).not.toHaveBeenCalled();
    expect(mocks.updateHook).not.toHaveBeenCalled();
  });

  it("clears the webhook with empty fields (pushes empties to NCM)", async () => {
    mocks.selectExisting.mockResolvedValueOnce([{ adminApiKey: "enc-key", webhookSecret: null }] as never);

    const result = await saveNcmWebhook(undefined, form({ ncmSiteId: "1", ncmWebhookUrl: "", ncmWebhookSecret: "" }));

    expect(result).toMatchObject({ ok: true });
    expect(mocks.setNcmWebhook).toHaveBeenCalledWith(
      { url: "http://10.0.0.9:9443", adminApiKey: "admin-key" } as never,
      "",
      "",
    );
  });

  it("persists the secret encrypted at rest and pushes the config to NCM", async () => {
    const result = await saveNcmWebhook(
      undefined,
      form({ ncmSiteId: "1", ncmWebhookUrl: "https://dg.example/api/ncm/ingest", ncmWebhookSecret: "new-secret" }),
    );

    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("http://10.0.0.9:9443") });
    expect(mocks.setNcmWebhook).toHaveBeenCalledWith(
      { url: "http://10.0.0.9:9443", adminApiKey: "admin-key" } as never,
      "https://dg.example/api/ncm/ingest",
      "new-secret",
    );
    // Nothing in the action result or audit carries the plaintext secret.
    const audited = JSON.stringify(mocks.logAudit.mock.calls) + JSON.stringify(result);
    expect(audited).not.toContain("new-secret");
  });

  it("keeps the stored secret when the field is blank", async () => {
    const result = await saveNcmWebhook(
      undefined,
      form({ ncmSiteId: "1", ncmWebhookUrl: "https://dg.example/api/ncm/ingest", ncmWebhookSecret: "" }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(mocks.setNcmWebhook).toHaveBeenCalledWith(
      expect.anything(),
      "https://dg.example/api/ncm/ingest",
      "stored-secret", // decrypted from the existing row
    );
  });

  it("surfaces the NCM push error as an inline message", async () => {
    mocks.setNcmWebhook.mockRejectedValueOnce(new Error("NCM API responded 403: forbidden"));

    const result = await saveNcmWebhook(
      undefined,
      form({ ncmSiteId: "1", ncmWebhookUrl: "https://dg.example/api/ncm/ingest", ncmWebhookSecret: "s" }),
    );

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("403") });
  });

  it("refuses when the site has no NCM row yet", async () => {
    mocks.selectExisting.mockResolvedValueOnce([] as never);

    const result = await saveNcmWebhook(undefined, form({ ncmSiteId: "1", ncmWebhookUrl: "https://dg/x", ncmWebhookSecret: "s" }));

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("belum terhubung") });
    expect(mocks.setNcmWebhook).not.toHaveBeenCalled();
  });
});

describe("checkNcmNow (ticket 09)", () => {
  it("rejects non-superadmin before touching NCM", async () => {
    mocks.verifySession.mockResolvedValueOnce({ userId: 2, username: "op", role: "admin" });

    const result = await checkNcmNow(undefined, form({ ncmSiteId: "1" }));

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Unauthorized") });
    expect(mocks.checkNcmSite).not.toHaveBeenCalled();
  });

  it("reports OK when NCM answers", async () => {
    mocks.selectExisting.mockResolvedValueOnce([{ name: "HQ" }] as never);

    const result = await checkNcmNow(undefined, form({ ncmSiteId: "1" }));

    expect(mocks.checkNcmSite).toHaveBeenCalledWith(expect.anything(), { siteId: 1, siteName: "HQ" });
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("OK") });
  });

  it("reports the miss streak when NCM stays silent below threshold", async () => {
    mocks.selectExisting.mockResolvedValueOnce([{ name: "HQ" }] as never);
    mocks.checkNcmSite.mockResolvedValueOnce({
      siteId: 1, configured: true, ok: false, status: "online", missCount: 2,
      incidentId: null, incidentCreated: false, error: "timeout",
    } as never);

    const result = await checkNcmNow(undefined, form({ ncmSiteId: "1" }));

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("miss 2/3") });
  });

  it("reports OFFLINE + incident when the threshold is reached", async () => {
    mocks.selectExisting.mockResolvedValueOnce([{ name: "HQ" }] as never);
    mocks.checkNcmSite.mockResolvedValueOnce({
      siteId: 1, configured: true, ok: false, status: "offline", missCount: 3,
      incidentId: 101, incidentCreated: true, error: "timeout",
    } as never);

    const result = await checkNcmNow(undefined, form({ ncmSiteId: "1" }));

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("OFFLINE") });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("#101") });
  });

  it("rejects an invalid site id and an unknown site", async () => {
    const badId = await checkNcmNow(undefined, form({ ncmSiteId: "abc" }));
    expect(badId).toMatchObject({ ok: false });

    mocks.selectExisting.mockResolvedValueOnce([] as never);
    const unknown = await checkNcmNow(undefined, form({ ncmSiteId: "9" }));
    expect(unknown).toMatchObject({ ok: false, message: expect.stringContaining("tidak ditemukan") });
    expect(mocks.checkNcmSite).not.toHaveBeenCalledWith(expect.anything(), { siteId: 9, siteName: expect.anything() });
  });
});
