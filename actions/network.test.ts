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
// bidirectional-link and slot-validation behaviour can be asserted.
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

import { addPort, updatePort } from "./network";

const dialect = new PgDialect();
function queryOf(condition: unknown) {
  return dialect.sqlToQuery(condition as Parameters<typeof dialect.sqlToQuery>[0]);
}

const adminAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: 7,
};

// Device A (id 5) with a 24+4 faceplate; port 1 on it is linked to port 9 on
// the remote device.
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

describe("updatePort bidirectional link integrity (#34)", () => {
  it("keeps the remote back-link when the payload omits connectedToPortId", async () => {
    mocks.selectResult.mockResolvedValue([linkedPortRow]);

    const data: Parameters<typeof updatePort>[1] = {
      deviceId: 5,
      portIndex: 2,
      portMode: "Access",
      speed: "1G",
    };
    await updatePort(1, data);

    // Only the row update runs — no unlink/relink of the remote back-pointer.
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0].set).toMatchObject({ portMode: "Access", speed: "1G" });
  });

  it("explicitly clears the remote back-link when connectedToPortId is null", async () => {
    mocks.selectResult.mockResolvedValue([linkedPortRow]);

    const data: Parameters<typeof updatePort>[1] = {
      deviceId: 5,
      connectedToDeviceId: null,
      connectedToPortId: null,
    };
    await updatePort(1, data);

    expect(mocks.updateCalls).toHaveLength(2);
    const unlink = mocks.updateCalls[1];
    expect(unlink.set).toEqual({ connectedToDeviceId: null, connectedToPortId: null });
    expect(queryOf(unlink.where).params).toEqual([9]); // the stored remote port
  });

  it("unlinks the old peer and links the new one when connectedToPortId changes", async () => {
    mocks.selectResult.mockResolvedValue([linkedPortRow]);

    const data: Parameters<typeof updatePort>[1] = {
      deviceId: 5,
      connectedToDeviceId: 5,
      connectedToPortId: 11,
    };
    await updatePort(1, data);

    expect(mocks.updateCalls).toHaveLength(3);
    expect(queryOf(mocks.updateCalls[1].where).params).toEqual([9]); // unlink old peer
    expect(mocks.updateCalls[2].set).toEqual({ connectedToDeviceId: 5, connectedToPortId: 1 });
    expect(queryOf(mocks.updateCalls[2].where).params).toEqual([11]); // back-link new peer
  });

  it("does not touch the DB when unauthorized", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: false, message: "Unauthorized." });

    await expect(updatePort(1, { deviceId: 5 })).rejects.toThrow("Unauthorized.");
    expect(mocks.selectResult).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(0);
  });
});

describe("addPort bidirectional auto-link (#34)", () => {
  it("uses INSERT RETURNING and releases the target's previous back-link", async () => {
    mocks.selectResult.mockResolvedValue([faceplateDevice]);
    mocks.insertResult.mockResolvedValue([{ id: 77 }]);

    const data: Parameters<typeof addPort>[0] = {
      deviceId: 5,
      portName: "Te1/0/1",
      connectedToPortId: 9,
    };
    await addPort(data);

    // Device lookup only — no racy post-insert orderBy(id) fetch.
    expect(mocks.selectResult).toHaveBeenCalledTimes(1);
    expect(mocks.insertCalls).toHaveLength(1);
    expect(mocks.updateCalls).toHaveLength(2);

    const [release, link] = mocks.updateCalls;
    expect(release.set).toEqual({ connectedToDeviceId: null, connectedToPortId: null });
    const releaseWhere = queryOf(release.where);
    expect(releaseWhere.sql).toContain('"network_ports"."connected_to_port_id"');
    expect(releaseWhere.sql).toContain("<>");
    expect(releaseWhere.params).toEqual([9, 77]);

    expect(link.set).toEqual({ connectedToDeviceId: 5, connectedToPortId: 77 });
    expect(queryOf(link.where).params).toEqual([9]);
  });

  it("does not auto-link when connectedToPortId is absent", async () => {
    mocks.selectResult.mockResolvedValue([faceplateDevice]);
    mocks.insertResult.mockResolvedValue([{ id: 77 }]);

    const data: Parameters<typeof addPort>[0] = { deviceId: 5, portName: "Gi1/0/1" };
    await addPort(data);

    expect(mocks.updateCalls).toHaveLength(0);
  });
});