import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  owned: [] as { id: number; name: string }[],
  updates: [] as { set: Record<string, unknown> }[],
  revalidatePath: vi.fn(),
}));

vi.mock("../lib/action-auth", () => ({
  requireActiveSiteAction: vi.fn(),
  requireActiveSiteAdminAction: () => mocks.auth(),
}));
vi.mock("../lib/session", () => ({ verifySession: vi.fn() }));
vi.mock("../lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => mocks.revalidatePath(p) }));

// The tx select returns the racks the active site owns among the requested
// names; updates are recorded so the test can see what was written.
const tx = {
  select: () => ({ from: () => ({ where: () => ({ for: () => Promise.resolve(mocks.owned) }) }) }),
  update: () => ({ set: (set: Record<string, unknown>) => ({ where: () => { mocks.updates.push({ set }); return Promise.resolve(); } }) }),
};
vi.mock("../db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(mocks.owned.map((r) => ({ ...r, locationId: null }))) }) }), transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

import { reorderRacks } from "./rack-management";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  mocks.auth.mockResolvedValue({ ok: true, session: {}, activeSiteId: 7 });
  mocks.owned = [{ id: 1, name: "A1" }, { id: 2, name: "A2" }];
});

describe("reorderRacks", () => {
  it("writes the new row/slot for each moved rack and revalidates both rack pages", async () => {
    const res = await reorderRacks([
      { name: "A2", floorRow: "A", floorSlot: 1 },
      { name: "A1", floorRow: "A", floorSlot: 2 },
    ]);
    expect(res).toEqual({ success: true });
    expect(mocks.updates.map((u) => u.set)).toEqual([
      { floorRow: "A", floorSlot: 1 },
      { floorRow: "A", floorSlot: 2 },
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/rack");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/rack-manage");
  });

  it("refuses non-admins without touching the database", async () => {
    mocks.auth.mockResolvedValue({ ok: false, message: "Unauthorized. Active-site admin access required." });
    const res = await reorderRacks([{ name: "A1", floorRow: "A", floorSlot: 1 }]);
    expect(res).toEqual({ message: "Unauthorized. Active-site admin access required." });
    expect(mocks.updates).toHaveLength(0);
  });

  it("writes nothing when any rack is not in the active site (other site or legacy device-only rack)", async () => {
    const res = await reorderRacks([
      { name: "A1", floorRow: "A", floorSlot: 1 },
      { name: "OTHER-SITE", floorRow: "A", floorSlot: 2 },
    ]);
    expect(res.message).toMatch(/OTHER-SITE/);
    expect(mocks.updates).toHaveLength(0);
  });

  it("rejects bad input (slot out of range, too-long row, empty list)", async () => {
    expect((await reorderRacks([{ name: "A1", floorRow: "A", floorSlot: 0 }])).message).toBeTruthy();
    expect((await reorderRacks([{ name: "A1", floorRow: "ABCDE", floorSlot: 1 }])).message).toBeTruthy();
    expect((await reorderRacks([])).message).toBeTruthy();
    expect(mocks.updates).toHaveLength(0);
  });

  it("normalises the row like the rack form (trim + uppercase, blank = null)", async () => {
    await reorderRacks([
      { name: "A1", floorRow: " a ", floorSlot: 1 },
      { name: "A2", floorRow: "", floorSlot: 1 },
    ]);
    expect(mocks.updates.map((u) => u.set.floorRow)).toEqual(["A", null]);
  });
});
