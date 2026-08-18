import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  requireSuperadminAction: vi.fn(),
  findFirstUser: vi.fn(),
  findFirstArgs: [] as unknown[][],
}));

vi.mock("../lib/session", () => ({
  verifySession: (...args: unknown[]) => mocks.verifySession(...args),
}));

vi.mock("../lib/action-auth", () => ({
  requireSuperadminAction: (...args: unknown[]) => mocks.requireSuperadminAction(...args),
}));

vi.mock("../db", () => ({
  db: {
    query: {
      users: {
        findFirst: (...args: unknown[]) => {
          mocks.findFirstArgs.push(args);
          return mocks.findFirstUser();
        },
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../lib/upload", () => ({
  saveUploadFile: vi.fn(),
  deleteUploadFile: vi.fn(),
}));

vi.mock("../lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getUserById } from "./users";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirstArgs.length = 0;
  mocks.findFirstUser.mockResolvedValue(null);
  mocks.verifySession.mockResolvedValue(null);
});

describe("getUserById authorization (IDOR guard)", () => {
  it("returns null without querying when unauthenticated", async () => {
    await expect(getUserById(1)).resolves.toBeNull();
    expect(mocks.findFirstArgs).toHaveLength(0);
  });

  it("rejects a staff user reading another user's profile", async () => {
    mocks.verifySession.mockResolvedValue({
      userId: 10,
      username: "staff1",
      role: "staff",
    });

    await expect(getUserById(99)).resolves.toBeNull();
    expect(mocks.findFirstArgs).toHaveLength(0);
  });

  it("rejects an admin user reading another user's profile", async () => {
    mocks.verifySession.mockResolvedValue({
      userId: 11,
      username: "admin1",
      role: "admin",
    });

    await expect(getUserById(42)).resolves.toBeNull();
    expect(mocks.findFirstArgs).toHaveLength(0);
  });

  it("allows a user to read their own profile", async () => {
    mocks.verifySession.mockResolvedValue({
      userId: 7,
      username: "alice",
      role: "staff",
    });
    mocks.findFirstUser.mockResolvedValue({
      id: 7,
      username: "alice",
      email: "alice@example.com",
      role: "staff",
      isActive: true,
      passwordHash: "secret-hash",
    });

    const result = await getUserById(7);
    expect(result).toMatchObject({ id: 7, username: "alice", email: "alice@example.com", role: "staff" });
    expect(result).not.toHaveProperty("passwordHash");
    expect(mocks.findFirstArgs).toHaveLength(1);
  });

  it("allows a superadmin to read any user's profile", async () => {
    mocks.verifySession.mockResolvedValue({
      userId: 1,
      username: "root",
      role: "superadmin",
    });
    mocks.findFirstUser.mockResolvedValue({
      id: 99,
      username: "bob",
      email: "bob@example.com",
      role: "admin",
      isActive: true,
      passwordHash: "secret-hash",
    });

    const result = await getUserById(99);
    expect(result).toMatchObject({ id: 99, username: "bob", role: "admin" });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("returns null when the user no longer exists", async () => {
    mocks.verifySession.mockResolvedValue({
      userId: 7,
      username: "alice",
      role: "superadmin",
    });
    mocks.findFirstUser.mockResolvedValue(null);

    await expect(getUserById(404)).resolves.toBeNull();
  });
});