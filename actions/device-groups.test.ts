import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(),
  revalidatePath: vi.fn(),
  logAudit: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  // db operation log + recorded arguments (shared by db and the tx handle)
  order: [] as string[],
  wheres: [] as unknown[],
  insertValues: [] as unknown[],
  returningResults: [] as unknown[][],
  selectResults: [] as unknown[][],
  updateSets: [] as unknown[],
  tx: {} as Record<string, unknown>,
}));

vi.mock("../lib/action-auth", () => ({
  requireActiveSiteAction: vi.fn(),
  requireActiveSiteAdminAction: (...args: unknown[]) => mocks.requireActiveSiteAdminAction(...args),
}));
vi.mock("../lib/session", () => ({ verifySession: vi.fn() }));
vi.mock("../lib/audit", () => ({ logAudit: (...args: unknown[]) => mocks.logAudit(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));

// Mock the db module before importing the SUT. `transaction` forwards to its
// callback with a tx handle that shares the same select/insert/update/delete
// implementations, so the code under test runs inside a "transaction" against
// the same recorded state (pattern from actions/master-data.test.ts).
vi.mock("../db", () => {
  const select = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (cond: unknown) => {
        mocks.wheres.push(cond);
        mocks.order.push("select");
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      then: (...args: unknown[]) => {
        const result = mocks.selectResults.length > 0 ? mocks.selectResults.shift() : [];
        return Promise.resolve(result).then(
          args[0] as (v: unknown) => unknown,
          args[1] as (r: unknown) => unknown,
        );
      },
    };
    return chain;
  };

  const insert = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      values: (value: unknown) => {
        mocks.insertValues.push(value);
        mocks.order.push("insert");
        const resultChain: Record<string, (...args: unknown[]) => unknown> = {
          returning: () => {
            const result = mocks.returningResults.length > 0 ? mocks.returningResults.shift() : [];
            return Promise.resolve(result);
          },
          then: (...args: unknown[]) =>
            Promise.resolve(undefined).then(
              args[0] as (v: unknown) => unknown,
              args[1] as (r: unknown) => unknown,
            ),
        };
        return resultChain;
      },
    };
    return chain;
  };

  const update = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      set: (value: unknown) => {
        mocks.updateSets.push(value);
        mocks.order.push("update");
        const whereChain: Record<string, (...args: unknown[]) => unknown> = {
          where: (cond: unknown) => {
            mocks.wheres.push(cond);
            return Promise.resolve(undefined);
          },
        };
        return whereChain;
      },
    };
    return chain;
  };

  const del = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      where: (cond: unknown) => {
        mocks.wheres.push(cond);
        mocks.order.push("delete");
        return Promise.resolve(undefined);
      },
    };
    return chain;
  };

  const tx = { select, insert, update, delete: del };
  mocks.tx = tx as unknown as Record<string, unknown>;

  return {
    db: {
      select,
      insert,
      update,
      delete: del,
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      query: {
        deviceGroups: { findFirst: mocks.findFirst, findMany: mocks.findMany },
      },
    },
  };
});

import { db } from "../db";
import {
  addDeviceGroup,
  deleteDeviceGroup,
  getGroupDevices,
  getGroupUsers,
  updateDeviceGroup,
} from "./device-groups";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  query: { deviceGroups: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> } };
};

const dialect = new PgDialect();

const SITE_ID = 7;

const adminAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: SITE_ID,
};

const superadminAuth = {
  ok: true,
  session: { userId: 1, username: "root", role: "superadmin" } as never,
  activeSiteId: SITE_ID,
};

function queueSelect(...results: unknown[][]) {
  mocks.selectResults.push(...results);
}

function queueReturning(...results: unknown[][]) {
  mocks.returningResults.push(...results);
}

function groupForm(overrides: { deviceIds?: number[]; ownerIds?: number[]; isActive?: boolean; id?: number } = {}) {
  const fd = new FormData();
  fd.set("name", "Ops Team");
  fd.set("color", "#22c55e");
  if (overrides.id !== undefined) fd.set("id", String(overrides.id));
  for (const id of overrides.deviceIds ?? []) fd.append("deviceIds", String(id));
  for (const id of overrides.ownerIds ?? []) fd.append("ownerIds", String(id));
  if (overrides.isActive) fd.set("isActive", "on");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.wheres.length = 0;
  mocks.insertValues.length = 0;
  mocks.returningResults.length = 0;
  mocks.selectResults.length = 0;
  mocks.updateSets.length = 0;
  mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: false, message: "Unauthorized." });
  mocks.findFirst.mockResolvedValue(undefined);
  mocks.findMany.mockResolvedValue([]);
  // Default: db.transaction forwards to its callback with the tx handle.
  // Tests that simulate a failed transaction override with mockRejectedValue;
  // this restore keeps later tests unaffected (clearAllMocks does not reset
  // implementations).
  mockedDb.transaction.mockImplementation(async (fn: (t: typeof mocks.tx) => unknown) => fn(mocks.tx as never));
});

describe("addDeviceGroup (finding #26 transactional + #27 validation + #30 isActive)", () => {
  it("rejects unauthenticated/no-site guards without touching the db", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: false, message: "No active site selected." });

    const result = await addDeviceGroup(null, groupForm());

    expect(result).toEqual({ message: "No active site selected." });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("inserts the group row and binds membership inside ONE transaction", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    // resolveBinding: devices [1,2] belong to the site; owners [5,6] are active
    // staff with a userSites row for the site.
    queueSelect(
      [{ id: 1 }, { id: 2 }],
      [{ id: 5, role: "staff" }, { id: 6, role: "staff" }],
      [{ userId: 5 }, { userId: 6 }],
      // detachOwners full users scan (no one owns the group yet)
      [{ id: 9, responsibleForGroups: [] }],
      // bindGroup owner read: user 5 already owns group 3, user 6 owns none
      [{ id: 5, responsibleForGroups: ["3"] }, { id: 6, responsibleForGroups: [] }],
    );
    queueReturning([{ id: 42 }]);

    const result = await addDeviceGroup(null, groupForm({ deviceIds: [1, 2], ownerIds: [5, 6], isActive: true }));

    expect(result).toEqual({ success: true, message: "Group created" });
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    // #27: the device validation predicate pins ids + site, the owner predicate
    // pins ids + isActive.
    expect(dialect.sqlToQuery(mocks.wheres[0] as never).params).toEqual([1, 2, SITE_ID]);
    expect(dialect.sqlToQuery(mocks.wheres[1] as never).params).toEqual([5, 6, true]);
    // deviceGroups insert carries the form values incl. isActive
    expect(mocks.insertValues[0]).toMatchObject({
      siteId: SITE_ID,
      name: "Ops Team",
      color: "#22c55e",
      isActive: true,
    });
    // device_pics insert receives the validated device ids
    expect(mocks.insertValues[1]).toEqual([
      { deviceId: 1, groupId: 42, siteId: SITE_ID },
      { deviceId: 2, groupId: 42, siteId: SITE_ID },
    ]);
    // owner rewrites appended group 42 to both owners (5 keeps 3, 6 starts fresh)
    expect(mocks.updateSets).toEqual([
      { responsibleForGroups: ["3", "42"] },
      { responsibleForGroups: ["42"] },
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "device_group" }));
  });

  it("defaults a missing isActive checkbox to false (checkbox state is authoritative)", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    queueSelect(
      [{ id: 5, role: "staff" }],
      [{ userId: 5 }],
      [],
      [{ id: 5, responsibleForGroups: [] }],
    );
    queueReturning([{ id: 7 }]);

    await addDeviceGroup(null, groupForm({ ownerIds: [5] }));

    expect(mocks.insertValues[0]).toMatchObject({ isActive: false });
  });

  it("rejects cross-site devices with an honest message and never inserts", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    // only device 1 belongs to the site — device 2 is dropped
    queueSelect([{ id: 1 }]);

    const result = await addDeviceGroup(null, groupForm({ deviceIds: [1, 2] }));

    expect(result).toEqual({ message: "1 perangkat tidak valid untuk site aktif." });
    expect(mocks.order).not.toContain("insert");
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1); // rejected → rolled back
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects owners without a userSites row for the site", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    queueSelect([{ id: 5, role: "staff" }], []);

    const result = await addDeviceGroup(null, groupForm({ ownerIds: [5] }));

    expect(result).toEqual({ message: "1 pengguna tidak memiliki akses ke site aktif." });
    expect(mocks.order).not.toContain("insert");
  });

  it("rejects deactivated owners", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    // owner 5 is filtered out by eq(users.isActive, true)
    queueSelect([]);

    const result = await addDeviceGroup(null, groupForm({ ownerIds: [5] }));

    expect(result).toEqual({ message: "1 pengguna tidak memiliki akses ke site aktif." });
    expect(mocks.order).not.toContain("insert");
  });

  it("accepts superadmin owners without a userSites row", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    queueSelect(
      [{ id: 5, role: "superadmin" }],
      [],
      [{ id: 5, responsibleForGroups: ["1"] }],
    );
    queueReturning([{ id: 42 }]);

    const result = await addDeviceGroup(null, groupForm({ ownerIds: [5] }));

    expect(result).toMatchObject({ success: true });
    expect(mocks.insertValues[0]).toMatchObject({ isActive: false });
    expect(mocks.updateSets).toEqual([{ responsibleForGroups: ["1", "42"] }]);
  });

  it("returns the generic error and performs no side effects when the transaction fails", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.transaction.mockRejectedValue(new Error("connection terminated"));

    const result = await addDeviceGroup(null, groupForm());

    expect(result).toEqual({ message: "Gagal menyimpan grup." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});

describe("updateDeviceGroup (finding #26 transactional + #70 updatedAt + #30 isActive)", () => {
  it("rejects a group outside the active site", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mocks.findFirst.mockResolvedValue(undefined);

    const result = await updateDeviceGroup(null, groupForm({ id: 9 }));

    expect(result).toEqual({ message: "Grup tidak ditemukan." });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("updates the group row and membership inside ONE transaction and sets updatedAt", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mocks.findFirst.mockResolvedValue({ id: 9, name: "Old Name", description: null, color: "#3b82f6", isActive: true });
    // no devices/owners requested → resolveBinding does no selects; the only
    // select is detachOwners' full users scan: user 9 already owns the group
    queueSelect([{ id: 9, responsibleForGroups: ["9"] }]);

    const result = await updateDeviceGroup(null, groupForm({ id: 9, deviceIds: [], ownerIds: [], isActive: true }));

    expect(result).toEqual({ success: true, message: "Group updated" });
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    // #70: the group row update carries a fresh updatedAt
    expect(mocks.updateSets[0]).toMatchObject({
      name: "Ops Team",
      isActive: true,
      updatedAt: expect.any(Date),
    });
    // detach rewrite of the stale owner ran inside the same tx
    expect(mocks.updateSets[1]).toEqual({ responsibleForGroups: [] });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entityId: 9 }));
  });

  it("sets isActive false when the checkbox was unchecked", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mocks.findFirst.mockResolvedValue({ id: 9, name: "Old Name", description: null, color: "#3b82f6", isActive: true });
    queueSelect([]);

    await updateDeviceGroup(null, groupForm({ id: 9 }));

    expect(mocks.updateSets[0]).toMatchObject({ isActive: false });
  });

  it("rejects cross-site devices and never runs the update", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mocks.findFirst.mockResolvedValue({ id: 9, name: "Old Name", description: null, color: "#3b82f6", isActive: true });
    queueSelect([{ id: 1 }]); // device 2 dropped

    const result = await updateDeviceGroup(null, groupForm({ id: 9, deviceIds: [1, 2] }));

    expect(result).toEqual({ message: "1 perangkat tidak valid untuk site aktif." });
    expect(mocks.order).not.toContain("update");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteDeviceGroup (finding #26 atomic delete)", () => {
  it("detaches owners BEFORE deleting the group row inside one transaction", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mocks.findFirst.mockResolvedValue({ id: 9, name: "Ops Team" });
    // detachOwners full scan: user 3 owns the group
    queueSelect([{ id: 3, responsibleForGroups: ["9", "2"] }]);

    const result = await deleteDeviceGroup(9);

    expect(result).toEqual({ success: true });
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    // detach (select + update) happened before the device_pics/device_groups deletes
    const txOps = mocks.order;
    const updateIdx = txOps.indexOf("update");
    const firstDeleteIdx = txOps.indexOf("delete");
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeLessThan(firstDeleteIdx);
    // two deletes: device_pics membership + the group row itself
    expect(txOps.filter((op) => op === "delete")).toHaveLength(2);
    // owner rewrite removed the group id
    expect(mocks.updateSets[0]).toEqual({ responsibleForGroups: ["2"] });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", entityId: 9 }));
  });

  it("returns the generic error and no side effects when the transaction fails", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mocks.findFirst.mockResolvedValue({ id: 9, name: "Ops Team" });
    mockedDb.transaction.mockRejectedValue(new Error("FK violation"));

    const result = await deleteDeviceGroup(9);

    expect(result).toEqual({ message: "Gagal menghapus grup." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});

describe("getGroupUsers / getGroupDevices (finding #28 site + isActive scoping)", () => {
  it("scopes the PIC picker to users with a userSites row for the active site, active only", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);

    await getGroupUsers();

    expect(mocks.order.filter((op) => op === "select").length).toBe(1);
    expect(dialect.sqlToQuery(mocks.wheres[0] as never).params).toEqual([SITE_ID, true]);
  });

  it("superadmin sees all active users without a site join", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(superadminAuth);

    await getGroupUsers();

    expect(dialect.sqlToQuery(mocks.wheres[0] as never).params).toEqual([true]);
  });

  it("returns neutral results when the guard fails", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: false, message: "Unauthorized." });

    await expect(getGroupUsers()).resolves.toEqual([]);
    await expect(getGroupDevices()).resolves.toEqual([]);
    expect(mocks.order).toHaveLength(0);
  });

  it("filters the device picker to the active site and active devices", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);

    await getGroupDevices();

    expect(dialect.sqlToQuery(mocks.wheres[0] as never).params).toEqual([SITE_ID, true]);
  });
});
