import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptString } from "../crypto";
import { resolveWatchGuardConnection, runServiceChecks, testConnection, type CheckTarget, type ResolvedConnection, type WatchGuardConnectionRow } from "./connection";
import { WatchGuardError } from "./errors";
import { authDeps, clearTokenCache, getToken } from "./auth";
import { connectionTestDeps } from "./connection";

const SECRET = "test-watchguard-encryption-secret-32-chars!";

function enc(v: string): string {
  return encryptString(v);
}

function row(overrides: Partial<WatchGuardConnectionRow> = {}): WatchGuardConnectionRow {
  return {
    id: 1,
    siteId: 1,
    enabled: true,
    region: "jpn",
    accountId: "WGC-3-123",
    apiKey: enc("pre-shared-api-key"),
    rwAccessId: "ACCESS-RW",
    rwPassword: enc("rw-password"),
    roAccessId: "ACCESS-RO",
    roPassword: enc("ro-password"),
    credentialRevision: 3,
    accountRevision: 2,
    ...overrides,
  };
}

const getRow = vi.fn();

beforeEach(() => {
  process.env.AI_KEY_ENCRYPTION_SECRET = SECRET;
  vi.clearAllMocks();
});

describe("resolveWatchGuardConnection", () => {
  it("prefers RO credentials in read mode", async () => {
    getRow.mockResolvedValue(row());
    const result = await resolveWatchGuardConnection(1, { mode: "read", deps: { getRow } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentials.accessId).toBe("ACCESS-RO");
      expect(result.credentials.password).toBe("ro-password");
      expect(result.credentials.apiKey).toBe("pre-shared-api-key");
      expect(result.credentialRevision).toBe(3);
    }
  });

  it("falls back to RW credentials in read mode when RO is absent", async () => {
    getRow.mockResolvedValue(row({ roAccessId: null, roPassword: null }));
    const result = await resolveWatchGuardConnection(1, { mode: "read", deps: { getRow } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.credentials.accessId).toBe("ACCESS-RW");
  });

  it("requires RW credentials in write mode", async () => {
    getRow.mockResolvedValue(row({ rwAccessId: null, rwPassword: null }));
    const result = await resolveWatchGuardConnection(1, { mode: "write", deps: { getRow } });
    expect(result).toMatchObject({ ok: false, reason: "missing_write_credentials" });
  });

  it("rejects a disabled connection unless allowDisabled is set", async () => {
    getRow.mockResolvedValue(row({ enabled: false }));
    expect(await resolveWatchGuardConnection(1, { deps: { getRow } })).toMatchObject({ ok: false, reason: "disabled" });
    expect(await resolveWatchGuardConnection(1, { allowDisabled: true, deps: { getRow } })).toMatchObject({ ok: true });
  });

  it("reports not_configured for a missing row and unknown_region for a bad region", async () => {
    getRow.mockResolvedValue(null);
    expect(await resolveWatchGuardConnection(9, { deps: { getRow } })).toMatchObject({ ok: false, reason: "not_configured" });

    getRow.mockResolvedValue(row({ region: "eu" }));
    expect(await resolveWatchGuardConnection(1, { deps: { getRow } })).toMatchObject({ ok: false, reason: "unknown_region" });
  });

  it("reports not_configured when a stored secret cannot be decrypted", async () => {
    getRow.mockResolvedValue(row({ roPassword: "not-an-envelope" }));
    expect(await resolveWatchGuardConnection(1, { deps: { getRow } })).toMatchObject({ ok: false, reason: "not_configured" });
  });
});

describe("runServiceChecks", () => {
  it("reports each service separately, isolating a single failure", async () => {
    const target: CheckTarget = {
      getToken: () => Promise.resolve({ token: "t" }),
      getAccount: () => Promise.resolve({}),
      getLicenses: () => Promise.reject(new WatchGuardError("forbidden", "forbidden", { status: 403 })),
      listIncidents: () => Promise.resolve({}),
    };
    const result = await runServiceChecks(target);
    expect(result.auth.ok).toBe(true);
    expect(result.account.ok).toBe(true);
    expect(result.endpointSecurity.ok).toBe(false);
    expect(result.endpointSecurity.kind).toBe("forbidden");
    expect(result.threatSync.ok).toBe(true);
  });
});

describe("testConnection", () => {
  function cred(accessId: string): ResolvedConnection {
    return {
      ok: true,
      region: "jpn",
      accountId: "WGC-3-123",
      credentialRevision: 0,
      accountRevision: 0,
      credentials: { region: "jpn", accountId: "WGC-3-123", accessId, password: "pw", apiKey: "k" },
    };
  }

  function allOk(): CheckTarget {
    return {
      getToken: () => Promise.resolve({ token: "t" }),
      getAccount: () => Promise.resolve({}),
      getLicenses: () => Promise.resolve({}),
      listIncidents: () => Promise.resolve({}),
    };
  }

  it("returns not-configured when no credential set resolves", async () => {
    const deps = {
      resolve: vi.fn(async () => ({ ok: false, reason: "not_configured" as const })),
      buildClient: vi.fn(() => ({})),
      checkTarget: vi.fn(() => allOk()),
    };
    const result = await testConnection(1, deps as never);
    expect(result).toMatchObject({ configured: false, reason: "not_configured" });
  });

  it("reuses identical complete credentials while reporting both modes", async () => {
    const deps = {
      resolve: vi.fn(async () => cred("same-access")),
      buildClient: vi.fn(() => ({})),
      checkTarget: vi.fn(() => allOk()),
    };
    const result = await testConnection(1, deps as never);
    expect(result).toMatchObject({ configured: true });
    if ("configured" in result && result.configured) {
      expect(result.read).toBeDefined();
      expect(result.write).toEqual(result.read);
      expect(deps.checkTarget).toHaveBeenCalledTimes(1);
    }
  });

  it("runs both read and write checks when RW differs", async () => {
    const deps = {
      resolve: vi.fn(async (_siteId: number, opts: { mode: string }) => cred(opts.mode === "read" ? "ro-access" : "rw-access")),
      buildClient: vi.fn(() => ({})),
      checkTarget: vi.fn(() => allOk()),
    };
    const result = await testConnection(1, deps as never);
    if ("configured" in result && result.configured) {
      expect(result.read).toBeDefined();
      expect(result.write).toBeDefined();
    }
  });
});

describe("offline diagnostic regressions", () => {
  it.each([{ roAccessId: null }, { roPassword: null }, { roAccessId: "" }, { roPassword: "" }])("rejects partial RO without mixing or falling back: %j", async (partial) => {
    getRow.mockResolvedValue(row(partial));
    expect(await resolveWatchGuardConnection(1, { deps: { getRow } })).toEqual({ ok: false, reason: "partial_read_credentials" });
  });

  it("reports the actual fallback source", async () => {
    getRow.mockResolvedValue(row({ roAccessId: null, roPassword: null }));
    expect(await resolveWatchGuardConnection(1, { deps: { getRow } })).toMatchObject({ ok: true, credentialSource: "rw" });
    getRow.mockResolvedValue(row());
    expect(await resolveWatchGuardConnection(1, { deps: { getRow } })).toMatchObject({ ok: true, credentialSource: "ro" });
  });

  it("does not call REST after OAuth failure or expose raw exceptions", async () => {
    const rest = vi.fn();
    const result = await runServiceChecks({ getToken: () => { throw new WatchGuardError("auth", "raw body secret", { status: 401 }); }, getAccount: rest, getLicenses: rest, listIncidents: rest });
    expect(rest).not.toHaveBeenCalled();
    expect(result.auth).toMatchObject({ ok: false, stage: "oauth", status: 401 });
    expect(result.account).toMatchObject({ ok: false, stage: "rest", skipped: true, status: null });
    expect(JSON.stringify(result)).not.toContain("raw body secret");
  });

  it("waits for OAuth before starting REST", async () => {
    let finish!: () => void;
    const rest = vi.fn(async () => ({}));
    const pending = runServiceChecks({ getToken: () => new Promise<void>((resolve) => { finish = resolve; }), getAccount: rest, getLicenses: rest, listIncidents: rest });
    expect(rest).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(rest).toHaveBeenCalledTimes(3);
  });

  it("tests distinct passwords with the same ID and surfaces unresolved modes", async () => {
    const resolved = async (password: string) => {
      getRow.mockResolvedValue(row({ roAccessId: "same", rwAccessId: "same", roPassword: enc(password), rwPassword: enc("other") }));
      return resolveWatchGuardConnection(1, { deps: { getRow } });
    };
    const a = await resolved("first");
    const b = await resolved("second");
    const target = vi.fn(() => ({ getToken: async () => ({}), getAccount: async () => ({}), getLicenses: async () => ({}), listIncidents: async () => ({}) }));
    const resolve = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    await testConnection(1, { ...connectionTestDeps, resolve, checkTarget: target });
    expect(target).toHaveBeenCalledTimes(2);
    resolve.mockResolvedValueOnce({ ok: false, reason: "partial_read_credentials" }).mockResolvedValueOnce(b);
    const result = await testConnection(1, { ...connectionTestDeps, resolve, checkTarget: target });
    expect(result).toMatchObject({ configured: true, unresolved: { read: "partial_read_credentials" }, read: { auth: { ok: false, skipped: true, stage: "resolve" } }, write: { auth: { ok: true } } });
  });

  it("shares fresh scoped OAuth with real REST probes without changing the normal cache", async () => {
    clearTokenCache();
    getRow.mockResolvedValue(row());
    const resolved = await resolveWatchGuardConnection(1, { deps: { getRow } });
    if (!resolved.ok) throw new Error("fixture");
    let oauthCalls = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/oauth/token")) {
        oauthCalls++;
        return new Response(JSON.stringify({ access_token: oauthCalls === 1 ? "normal" : "diagnostic", expires_in: 3600 }));
      }
      expect(init?.headers).toMatchObject({ Authorization: "Bearer diagnostic" });
      const body = new URL(String(url)).pathname.endsWith("/incidents")
        ? { items: [], count: 0 }
        : { data: [] };
      return new Response(JSON.stringify(body));
    });
    const originalAuthFetch = authDeps.fetch;
    authDeps.fetch = fetch;
    try {
      await getToken(resolved.credentials, { credentialRevision: 3 });
      const resolve = vi.fn(async () => resolved);
      const result = await testConnection(1, {
        ...connectionTestDeps,
        resolve,
        checkTarget: (credentials, options) => connectionTestDeps.checkTarget(credentials, { ...options, fetch }),
      });
      expect(result).toMatchObject({ configured: true, read: { auth: { ok: true }, account: { ok: true }, endpointSecurity: { ok: true }, threatSync: { ok: true } } });
      expect(oauthCalls).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(5);
      expect((await getToken(resolved.credentials, { credentialRevision: 3 })).token).toBe("normal");
      expect(oauthCalls).toBe(2);
    } finally { authDeps.fetch = originalAuthFetch; clearTokenCache(); }
  });

  it("fresh diagnostic OAuth bypasses a warm normal cache without replacing it", async () => {
    clearTokenCache();
    getRow.mockResolvedValue(row());
    const resolved = await resolveWatchGuardConnection(1, { deps: { getRow } });
    if (!resolved.ok) throw new Error("fixture");
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "normal", expires_in: 3600 }))).mockResolvedValue(new Response("raw sensitive body", { status: 401 }));
    const original = authDeps.fetch;
    authDeps.fetch = fetch;
    try {
      await getToken(resolved.credentials, { credentialRevision: 3 });
      const resolve = vi.fn(async () => resolved);
      const result = await testConnection(1, { ...connectionTestDeps, resolve });
      expect(result).toMatchObject({ configured: true, read: { auth: { ok: false, status: 401 }, account: { skipped: true } } });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((await getToken(resolved.credentials, { credentialRevision: 3 })).token).toBe("normal");
      expect(JSON.stringify(result)).not.toContain("raw sensitive body");
    } finally { authDeps.fetch = original; clearTokenCache(); }
  });
});
