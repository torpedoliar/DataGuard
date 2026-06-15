import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the database module with a fluent chain so we can drive the lockout
// branches of `login` without touching Postgres.
const findFirstUsers = vi.fn();

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
  },
}));

const createSessionMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/session", () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

const redirectMock = vi.fn((url: string) => {
  // Mimic Next's redirect by throwing so flow stops
  throw new Error(`__REDIRECT__${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("./users", () => ({
  updateUserLastLogin: vi.fn().mockResolvedValue(undefined),
}));

const logAuditManualMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logAuditManual: (...args: unknown[]) => logAuditManualMock(...args),
}));

// Use real bcrypt with a known hash to keep behavior faithful.
import bcrypt from "bcryptjs";
import { login } from "./auth";

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
