import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(),
  selectResult: vi.fn(),
  insertResult: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  updateCalls: [] as { table: unknown; set: unknown; where: unknown }[],
  insertCalls: [] as unknown[],
}));

vi.mock("../lib/action-auth", () => ({
  requireActiveSiteAction: vi.fn(),
  requireActiveSiteAdminAction: (...args: unknown[]) => mocks.requireActiveSiteAdminAction(...args),
}));

vi.mock("../lib/session", () => ({ verifySession: vi.fn() }));
vi.mock("../lib/audit", () => ({ logAudit: (...args: unknown[]) => mocks.logAudit(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));

// Mock the db module before importing the SUT. The select/insert chains resolve
// to per-test fixtures; update records every (set, where) pair so the
// slot-validation behaviour can be asserted.
vi.mock("../db", () => ({
  db: {
    select: () => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.from = () => chain;
      chain.innerJoin = () => chain;
      chain.leftJoin = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(mocks.selectResult()).then(onFulfilled, onRejected);
      return chain;
    },
    insert: (table: unknown) => {
      mocks.insertCalls.push(table);
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.values = () => chain;
      chain.returning = () => chain;
      chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(mocks.insertResult()).then(onFulfilled, onRejected);
      return chain;
    },
    update: (table: unknown) => {
      const entry = { table, set: undefined as unknown, where: undefined as unknown };
      mocks.updateCalls.push(entry);
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.set = (setValue: unknown) => {
        entry.set = setValue;
        return chain;
      };
      chain.where = (whereValue: unknown) => {
        entry.where = whereValue;
        return Promise.resolve();
      };
      return chain;
    },
  },
}));

import { addPort, updatePort, updatePortSlot } from "./network";

const dialect = new PgDialect();
function queryOf(condition: unknown) {
  return dialect.sqlToQuery(condition as Parameters<typeof dialect.sqlToQuery>[0]);
}

const adminAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: 7,
};

// Device A (id 5) with a 24+4 faceplate.
const faceplateDevice = { id: 5, faceplatePortCount: 24, faceplateUplinkCount: 4 };
const linkedPortRow = {
  id: 1,
  deviceId: 5,
  connectedToPortId: 9,
  faceplatePortCount: 24,
  faceplateUplinkCount: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateCalls.length = 0;
  mocks.insertCalls.length = 0;
  mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
  mocks.selectResult.mockResolvedValue([]);
  mocks.insertResult.mockResolvedValue([]);
});

describe("faceplate slot override bounds (#35)", () => {
  it("rejects an out-of-range slot in updatePortSlot", async () => {
    mocks.selectResult.mockResolvedValue([{ id: 3, deviceId: 5, portName: "Gi1/0/1", ...faceplateDevice }]);

    await expect(updatePortSlot(3, 999)).rejects.toThrow("di luar layout faceplate");
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("accepts the maximum slot in updatePortSlot", async () => {
    mocks.selectResult.mockResolvedValue([{ id: 3, deviceId: 5, portName: "Gi1/0/1", ...faceplateDevice }]);

    await updatePortSlot(3, 28);

    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0].set).toEqual({ portIndex: 28 });
  });

  it("rejects any slot when the device has no faceplate layout", async () => {
    mocks.selectResult.mockResolvedValue([{ id: 3, deviceId: 5, portName: "Gi1/0/1", faceplatePortCount: null, faceplateUplinkCount: 0 }]);

    await expect(updatePortSlot(3, 2)).rejects.toThrow("belum memiliki layout faceplate");
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("clears the override when portIndex is null", async () => {
    mocks.selectResult.mockResolvedValue([{ id: 3, deviceId: 5, portName: "Gi1/0/1", ...faceplateDevice }]);

    await updatePortSlot(3, null);

    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0].set).toEqual({ portIndex: null });
  });

  it("rejects an out-of-range portIndex in addPort before inserting", async () => {
    mocks.selectResult.mockResolvedValue([faceplateDevice]);

    const data: Parameters<typeof addPort>[0] = { deviceId: 5, portName: "Gi1/0/1", portIndex: 999 };
    await expect(addPort(data)).rejects.toThrow("di luar layout faceplate");
    expect(mocks.insertCalls).toHaveLength(0);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("accepts a portIndex inside the faceplate range in addPort", async () => {
    mocks.selectResult.mockResolvedValue([faceplateDevice]);
    mocks.insertResult.mockResolvedValue([{ id: 80 }]);

    const data: Parameters<typeof addPort>[0] = { deviceId: 5, portName: "Gi1/0/7", portIndex: 7 };
    await addPort(data);

    expect(mocks.insertCalls).toHaveLength(1);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("rejects an out-of-range portIndex in updatePort", async () => {
    mocks.selectResult.mockResolvedValue([linkedPortRow]);

    const data: Parameters<typeof updatePort>[1] = { deviceId: 5, portIndex: 999 };
    await expect(updatePort(1, data)).rejects.toThrow("di luar layout faceplate");
    expect(mocks.updateCalls).toHaveLength(0);
  });
});