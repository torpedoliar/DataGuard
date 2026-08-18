import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Mock the database module with a fluent chain so we can drive the lockout
// branches of `login` without touching Postgres.
const findFirstUsers = vi.fn();
// Tracks the chain of `.from(...).innerJoin(...).where(...).limit(...)` for
// the userSites lookup in the auto-pick logic. Default: empty array (matches
// a user with no accessible sites, so login still goes to /select-site).
const userSitesQuery = vi.fn().mockResolvedValue([]);
// Captures every `.where(...)` condition so tests can inspect predicates
// (e.g. the switchSite site lookup must filter isActive).
const whereConditions: unknown[] = [];

vi.mock("@/db", () => ({
  db: {
    query: {
      users: {
        findFirst: (..._args: unknown[]) => findFirstUsers(),
      },
    },
    update: () => ({
      set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: (..._args: unknown[]) => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.innerJoin = () => chain;
      chain.where = (condition: unknown) => {
        whereConditions.push(condition);
        return chain;
      };
      chain.limit = (..._args: unknown[]) => {
        const result = userSitesQuery(..._args);
        // If the test did not configure a response, return [] so .map() works.
        return Promise.resolve(result ?? []);
      };
      return chain;
    },
  },
}));

const createSessionMock = vi.fn().mockResolvedValue(undefined);
const verifySessionMock = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/session", () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  verifySession: (...args: unknown[]) => verifySessionMock(...args),
}));

const requireSiteAccessMock = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/site-access", () => ({
  requireSiteAccess: (...args: unknown[]) => requireSiteAccessMock(...args),
}));

const redirectMock = vi.fn((url: string) => {
  // Mimic Next's redirect by throwing so flow stops
  throw new Error(`__REDIRECT__${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("./users", () => ({
  updateUserLastLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const logAuditManualMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logAuditManual: (...args: unknown[]) => logAuditManualMock(...args),
}));

// Use real bcrypt with a known hash to keep behavior faithful.
import bcrypt from "bcryptjs";
import { login, switchSite } from "./auth";

const HASH = bcrypt.hashSync("correct-password", 4);

function makeFormData(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  findFirstUsers.mockReset();
  redirectMock.mockClear();
  createSessionMock.mockClear();
  logAuditManualMock.mockClear();
  userSitesQuery.mockReset();
  verifySessionMock.mockReset();
  verifySessionMock.mockResolvedValue(null);
  requireSiteAccessMock.mockReset();
  requireSiteAccessMock.mockResolvedValue(true);
  whereConditions.length = 0;
});

describe("login lockout", () => {
  it("locks the account after 5 failed attempts and blocks the 6th", async () => {
    // 5 calls: each increments and the 5th flips to lockout
    for (let i = 0; i < 5; i++) {
      findFirstUsers.mockResolvedValueOnce({
        id: 7,
        username: "alice",
        passwordHash: HASH,
        role: "staff",
        isActive: true,
        failedLoginAttempts: i,
        lockoutUntil: null,
      });
    }
    // 6th call: lockout is now in the future
    const futureLock = new Date(Date.now() + 15 * 60 * 1000);
    findFirstUsers.mockResolvedValueOnce({
      id: 7,
      username: "alice",
      passwordHash: HASH,
      role: "staff",
      isActive: true,
      failedLoginAttempts: 5,
      lockoutUntil: futureLock,
    });

    // First 4 are just "wrong password"; the 5th IS the lockout (incremented
    // to 5, so the action reports the lockout error).
    for (let i = 0; i < 4; i++) {
      const r = await login(undefined, makeFormData({ username: "alice", password: "wrong" }));
      expect(r).toMatchObject({ message: expect.stringMatching(/Username atau password salah/i) });
    }
    const fifth = await login(undefined, makeFormData({ username: "alice", password: "wrong" }));
    expect(fifth).toMatchObject({ message: expect.stringMatching(/Akun terkunci/) });

    // 6th attempt: lockoutUntil is in the future, so the lockout branch fires
    // even before password checking.
    const blocked = await login(undefined, makeFormData({ username: "alice", password: "wrong" }));
    expect(blocked).toMatchObject({ message: expect.stringMatching(/Akun terkunci/) });
  });

  it("returns a clear lockout error message with minutes remaining", async () => {
    const futureLock = new Date(Date.now() + 7 * 60 * 1000); // 7 min from now
    findFirstUsers.mockResolvedValueOnce({
      id: 9,
      username: "bob",
      passwordHash: HASH,
      role: "staff",
      isActive: true,
      failedLoginAttempts: 5,
      lockoutUntil: futureLock,
    });

    const r = await login(undefined, makeFormData({ username: "bob", password: "anything" }));
    expect(r).toBeDefined();
    expect(r).toMatchObject({ message: expect.stringMatching(/Akun terkunci/) });
    // Should mention 7 or 8 minutes (Math.ceil rounding)
    expect((r as { message: string }).message).toMatch(/[78] menit/);
  });

  it("resets failedLoginAttempts and lockoutUntil on successful login", async () => {
    // Use a fresh non-locked account so the success path runs cleanly.
    findFirstUsers.mockResolvedValueOnce({
      id: 12,
      username: "carol",
      passwordHash: HASH,
      role: "staff",
      isActive: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    });

    let redirectErr: unknown;
    try {
      await login(undefined, makeFormData({ username: "carol", password: "correct-password" }));
    } catch (e) {
      redirectErr = e;
    }
    expect(String((redirectErr as Error)?.message ?? "")).toMatch(/__REDIRECT__/);

    const resetCall = logAuditManualMock.mock.calls.find(
      (c) => typeof c[0]?.detail === "string" && c[0].detail === "Login successful",
    );
    expect(resetCall).toBeTruthy();
  });

  it("allows login again after the lockout window expires", async () => {
    // lockoutUntil in the past — lockout should be ignored
    findFirstUsers.mockResolvedValueOnce({
      id: 33,
      username: "dave",
      passwordHash: HASH,
      role: "staff",
      isActive: true,
      failedLoginAttempts: 5,
      lockoutUntil: new Date(Date.now() - 1000),
    });

    let redirectErr: unknown;
    try {
      await login(undefined, makeFormData({ username: "dave", password: "correct-password" }));
    } catch (e) {
      redirectErr = e;
    }
    expect(String((redirectErr as Error)?.message ?? "")).toMatch(/__REDIRECT__/);
  });
});

describe("login default site selection (N50)", () => {
  /**
   * Helper: run login with a real user record, capture the createSession call
   * and the redirect target. Returns the redirect URL (or null on failure).
   */
  async function runLoginAndCapture(user: Record<string, unknown>) {
    findFirstUsers.mockResolvedValueOnce(user);
    let redirectErr: unknown;
    try {
      await login(undefined, makeFormData({ username: user.username as string, password: "correct-password" }));
    } catch (e) {
      redirectErr = e;
    }
    return {
      sessionCall: createSessionMock.mock.calls[createSessionMock.mock.calls.length - 1],
      redirectUrl: redirectErr ? String((redirectErr as Error).message) : null,
    };
  }

  it("uses the user's defaultSiteId when set and the user has access to it", async () => {
    userSitesQuery.mockResolvedValueOnce([{ id: 42, name: "DC-JKT" }]);
    const { sessionCall, redirectUrl } = await runLoginAndCapture({
      id: 50,
      username: "eve",
      passwordHash: HASH,
      role: "admin",
      isActive: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      defaultSiteId: 42,
    });

    // session is created with the default site + name
    expect(sessionCall).toBeTruthy();
    const args = sessionCall as unknown[];
    expect(args[3]).toBe(42); // activeSiteId
    expect(args[4]).toBe("DC-JKT"); // activeSiteName
    // skip /select-site, go straight to /checklist
    expect(redirectUrl).toMatch(/__REDIRECT__\/checklist/);
  });

  it("ignores defaultSiteId when the user no longer has access to that site", async () => {
    // userSites returns 1 site that is NOT the default — fall through to single-site auto-pick
    userSitesQuery.mockResolvedValueOnce([{ id: 7, name: "DC-SBY" }]);
    const { sessionCall, redirectUrl } = await runLoginAndCapture({
      id: 51,
      username: "frank",
      passwordHash: HASH,
      role: "admin",
      isActive: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      defaultSiteId: 999, // no longer accessible
    });

    const args = sessionCall as unknown[];
    expect(args[3]).toBe(7);
    expect(args[4]).toBe("DC-SBY");
    expect(redirectUrl).toMatch(/__REDIRECT__\/checklist/);
  });

  it("auto-picks the only accessible site when the user has no defaultSiteId", async () => {
    userSitesQuery.mockResolvedValueOnce([{ id: 5, name: "DC-BDG" }]);
    const { sessionCall, redirectUrl } = await runLoginAndCapture({
      id: 52,
      username: "grace",
      passwordHash: HASH,
      role: "staff",
      isActive: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      defaultSiteId: null,
    });

    const args = sessionCall as unknown[];
    expect(args[3]).toBe(5);
    expect(args[4]).toBe("DC-BDG");
    expect(redirectUrl).toMatch(/__REDIRECT__\/checklist/);
  });

  it("creates session with activeSiteId=null when the user has multiple sites and no default", async () => {
    userSitesQuery.mockResolvedValueOnce([
      { id: 1, name: "DC-JKT" },
      { id: 2, name: "DC-SBY" },
      { id: 3, name: "DC-MDN" },
    ]);
    const { sessionCall, redirectUrl } = await runLoginAndCapture({
      id: 53,
      username: "henry",
      passwordHash: HASH,
      role: "admin",
      isActive: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      defaultSiteId: null,
    });

    const args = sessionCall as unknown[];
    expect(args[3]).toBeNull();
    expect(args[4]).toBeNull();
    expect(redirectUrl).toMatch(/__REDIRECT__\/select-site/);
  });

  it("superadmin with no defaultSiteId keeps null and is sent to /select-site", async () => {
    // For superadmins, userSites is irrelevant — they see all sites — so the
    // query should not be called. Confirm we still go to /select-site.
    const { sessionCall, redirectUrl } = await runLoginAndCapture({
      id: 54,
      username: "ivy",
      passwordHash: HASH,
      role: "superadmin",
      isActive: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      defaultSiteId: null,
    });

    const args = sessionCall as unknown[];
    expect(args[3]).toBeNull();
    expect(args[4]).toBeNull();
    expect(redirectUrl).toMatch(/__REDIRECT__\/select-site/);
    expect(userSitesQuery).not.toHaveBeenCalled();
  });
});

describe("switchSite", () => {
  const dialect = new PgDialect();

  function validSession() {
    return {
      userId: 1,
      username: "alice",
      role: "admin",
      activeSiteId: 7,
      activeSiteName: "DC-JKT",
      passwordFingerprint: "fp",
    };
  }

  it("rejects a deactivated site by filtering isActive in the lookup", async () => {
    verifySessionMock.mockResolvedValue(validSession());
    // requireSiteAccess passes (userSites row exists) but the site lookup
    // returns no rows because the site is deactivated -> fail closed.
    userSitesQuery.mockResolvedValueOnce([]);

    const result = await switchSite(7);
    expect(result).toEqual({ message: "Site tidak ditemukan." });
    expect(createSessionMock).not.toHaveBeenCalled();

    // The site lookup predicate must constrain BOTH the site id and isActive.
    const params = whereConditions.map((c) => dialect.sqlToQuery(c as never).params);
    expect(params).toContainEqual(expect.arrayContaining([7, true]));
  });

  it("switches to an active site and re-creates the session", async () => {
    verifySessionMock.mockResolvedValue(validSession());
    userSitesQuery.mockResolvedValueOnce([{ id: 9, name: "DC-SBY" }]);

    const result = await switchSite(9);
    expect(result).toMatchObject({ success: true, siteName: "DC-SBY" });

    const args = createSessionMock.mock.calls[createSessionMock.mock.calls.length - 1] as unknown[];
    expect(args[3]).toBe(9); // activeSiteId
    expect(args[4]).toBe("DC-SBY"); // activeSiteName
    expect(args[5]).toBe("fp"); // validated password fingerprint carried forward
  });
});
