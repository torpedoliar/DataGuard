import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(),
  findRack: vi.fn(),
  rackFindFirstArgs: [] as unknown[][],
  selectConditions: [] as unknown[],
  selectCount: 0,
  deleteWhere: vi.fn(),
  updateSet: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("../lib/action-auth", () => ({
  requireActiveSiteAction: vi.fn(),
  requireActiveSiteAdminAction: (...args: unknown[]) => mocks.requireActiveSiteAdminAction(...args),
}));

vi.mock("../lib/session", () => ({ verifySession: vi.fn() }));
vi.mock("../lib/audit", () => ({ logAudit: (...args: unknown[]) => mocks.logAudit(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("../db", () => ({
  db: {
    select: () => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.from = () => chain;
      chain.where = (condition: unknown) => {
        mocks.selectConditions.push(condition);
        return chain;
      };
      chain.then = (...args: unknown[]) => {
        const [onFulfilled] = args;
        return Promise.resolve([{ deviceCount: mocks.selectCount }]).then(
          onFulfilled as (value: unknown[]) => unknown,
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
      devices: { findMany: vi.fn().mockResolvedValue([]) },
    },
    delete: () => ({ where: (...args: unknown[]) => mocks.deleteWhere(...args) }),
    update: () => ({ set: (...args: unknown[]) => mocks.updateSet(...args) }),
  },
}));

import { deleteRack, updateRack } from "./rack-management";

const adminAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: 7,
};

const RACK_IN_USE = "Gagal menghapus rak ini karena mungkin masih berisi perangkat server aktif.";

function rackFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("id", "5");
  fd.set("name", "Rack A");
  const all = { id: "5", name: "Rack A", ...overrides };
  for (const [key, value] of Object.entries(all)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rackFindFirstArgs.length = 0;
  mocks.selectConditions.length = 0;
  mocks.selectCount = 0;
  mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
  mocks.findRack.mockResolvedValue({ id: 5, name: "Rack A", zone: "DC-1", totalU: 42 });
  mocks.deleteWhere.mockResolvedValue(undefined);
  mocks.updateSet.mockResolvedValue(undefined);
});

describe("deleteRack (finding #11: refuse while devices reference the rack)", () => {
  it("returns the real in-use message and never deletes when devices reference the rack", async () => {
    mocks.selectCount = 2;

    const result = await deleteRack(5);

    expect(result).toEqual({ message: RACK_IN_USE });
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });

  it("deletes the rack when no device references it (count 0)", async () => {
    const result = await deleteRack(5);

    expect(result).toEqual({ success: true });
    expect(mocks.deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", entityId: 5 }));
  });

  it("reports a missing rack without counting devices", async () => {
    mocks.findRack.mockResolvedValue(null);

    const result = await deleteRack(5);

    expect(result).toEqual({ message: "Rak tidak ditemukan di site aktif." });
    expect(mocks.selectConditions).toHaveLength(0);
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });
});

describe("updateRack partial updates (finding #64)", () => {
  it("keeps the stored isAuditable when the form omits the checkbox", async () => {
    mocks.findRack.mockResolvedValue({ id: 5, name: "Rack A", zone: "DC-1", totalU: 42, isAuditable: true });

    // FormData without an isAuditable field (only a rename)
    await updateRack(null, rackFormData({ name: "Rack B" }));

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      isAuditable: true,
    }));
  });

  it("stores the checkbox value when the form sends it", async () => {
    await updateRack(null, rackFormData({ isAuditable: "on" }));

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      isAuditable: true,
    }));
  });

  it("stores isAuditable=false when the form sends the unchecked hidden twin", async () => {
    // Checkbox is unchecked: the hidden <input name="isAuditable" value="false">
    // is the only value the browser submits. z.coerce.boolean() would coerce
    // the string "false" to true, making the rack impossible to exclude.
    await updateRack(null, rackFormData({ isAuditable: "false" }));

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      isAuditable: false,
    }));
  });

  it("clears a scrubbed Zone input to null instead of ''", async () => {
    await updateRack(null, rackFormData({ zone: "" }));

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      zone: null,
    }));
  });

  it("keeps the stored zone when the form omits the field", async () => {
    mocks.findRack.mockResolvedValue({ id: 5, name: "Rack A", zone: "DC-1", totalU: 42, isAuditable: true });

    await updateRack(null, rackFormData({ name: "Rack B" }));

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      zone: "DC-1",
    }));
  });
});