import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAction: vi.fn(),
  select: vi.fn(),
  findRack: vi.fn(),
  whereConditions: [] as unknown[],
  rackFindFirstArgs: [] as unknown[][],
}));

vi.mock("../lib/action-auth", () => ({
  requireActiveSiteAction: (...args: unknown[]) => mocks.requireActiveSiteAction(...args),
  requireActiveSiteAdminAction: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  verifySession: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: (...args: unknown[]) => {
      mocks.select(...args);
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.from = () => chain;
      chain.leftJoin = () => chain;
      chain.where = (condition: unknown) => {
        mocks.whereConditions.push(condition);
        return chain;
      };
      chain.orderBy = () => chain;
      chain.then = (...args: unknown[]) => {
        const [onFulfilled, onRejected] = args;
        return Promise.resolve([] as unknown[]).then(
          onFulfilled as (value: unknown[]) => unknown,
          onRejected as ((reason: unknown) => unknown) | undefined,
        );
      };
      return chain;
    },
    query: {
      racks: {
        findFirst: (...args: unknown[]) => {
          mocks.rackFindFirstArgs.push(args);
          return mocks.findRack();
        },
      },
    },
  },
}));

vi.mock("../lib/upload", () => ({
  saveUploadFile: vi.fn(),
  deleteUploadFile: vi.fn(),
}));
vi.mock("../lib/rack-validation", () => ({ checkRackCollision: vi.fn() }));
vi.mock("../lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("../lib/site-access", () => ({ hasAdminAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getBrands } from "./brands";
import { getCategories, getDevices } from "./master-data";
import { getRackById, getRacks } from "./rack-management";

const dialect = new PgDialect();

function activeSiteAuth(activeSiteId = 7) {
  return {
    ok: true,
    session: { userId: 1, username: "operator", role: "staff" } as never,
    activeSiteId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.whereConditions.length = 0;
  mocks.rackFindFirstArgs.length = 0;
  mocks.findRack.mockResolvedValue(null);
  mocks.requireActiveSiteAction.mockResolvedValue({ ok: false, message: "Unauthorized." });
});

describe("site-scoped read actions", () => {
  it.each([
    { message: "Unauthorized." },
    { message: "No active site selected." },
  ])("returns neutral results and does not query for $message", async (failure) => {
    mocks.requireActiveSiteAction.mockResolvedValue(failure);

    await expect(getCategories()).resolves.toEqual([]);
    await expect(getBrands()).resolves.toEqual([]);
    await expect(getDevices()).resolves.toEqual([]);
    await expect(getRacks()).resolves.toEqual([]);
    await expect(getRackById(42)).resolves.toBeNull();

    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.rackFindFirstArgs).toHaveLength(0);
  });

  it("requires the active site in device and rack predicates", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(activeSiteAuth());

    await getCategories();
    await getBrands();
    await getDevices();
    await getRacks();
    await getRackById(42);

    const whereParams = mocks.whereConditions.map((condition) => dialect.sqlToQuery(condition as never).params);
    expect(whereParams).toEqual(expect.arrayContaining([
      expect.arrayContaining([7]),
    ]));

    const rackWhere = mocks.rackFindFirstArgs[0]?.[0] as { where: unknown };
    expect(dialect.sqlToQuery(rackWhere.where as never).params).toEqual(expect.arrayContaining([42, 7]));
  });
});
