import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptString } from "../crypto";
import { resolveWatchGuardConnection, runServiceChecks, testConnection, type CheckTarget, type ResolvedConnection, type WatchGuardConnectionRow } from "./connection";
import { WatchGuardError } from "./errors";

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

  it("runs read checks only when RO and RW access ids match", async () => {
    const deps = {
      resolve: vi.fn(async () => cred("same-access")),
      buildClient: vi.fn(() => ({})),
      checkTarget: vi.fn(() => allOk()),
    };
    const result = await testConnection(1, deps as never);
    expect(result).toMatchObject({ configured: true });
    if ("configured" in result && result.configured) {
      expect(result.read).toBeDefined();
      expect(result.write).toBeUndefined();
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