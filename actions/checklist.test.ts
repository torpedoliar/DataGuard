import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAction: vi.fn(),
  revalidatePath: vi.fn(),
  logAudit: vi.fn(),
  hasAdminAccess: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  createIncidentsForChecklistItems: vi.fn(),
  getTelegramAlertTemplate: vi.fn(),
  renderTelegramTemplate: vi.fn(),
  sendTelegramAlert: vi.fn(),
  resolveNotificationBaseUrl: vi.fn(),
  validateUpload: vi.fn(),
  saveUploadFile: vi.fn(),
  deleteUploadFile: vi.fn(),
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
  requireActiveSiteAction: (...args: unknown[]) => mocks.requireActiveSiteAction(...args),
}));
vi.mock("../lib/session", () => ({ verifySession: vi.fn() }));
vi.mock("../lib/audit", () => ({ logAudit: (...args: unknown[]) => mocks.logAudit(...args) }));
vi.mock("../lib/site-access", () => ({ hasAdminAccess: (...args: unknown[]) => mocks.hasAdminAccess(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));
vi.mock("../lib/upload", () => ({
  saveUploadFile: (...args: unknown[]) => mocks.saveUploadFile(...args),
  deleteUploadFile: (...args: unknown[]) => mocks.deleteUploadFile(...args),
  validateUpload: (...args: unknown[]) => mocks.validateUpload(...args),
  UploadValidationError: class UploadValidationError extends Error {},
}));
vi.mock("@/actions/incidents", () => ({
  createIncidentsForChecklistItems: (...args: unknown[]) => mocks.createIncidentsForChecklistItems(...args),
}));
vi.mock("@/actions/settings", () => ({
  getTelegramAlertTemplate: (...args: unknown[]) => mocks.getTelegramAlertTemplate(...args),
}));
vi.mock("@/lib/telegram", () => ({
  renderTelegramTemplate: (...args: unknown[]) => mocks.renderTelegramTemplate(...args),
  sendTelegramAlert: (...args: unknown[]) => mocks.sendTelegramAlert(...args),
}));
vi.mock("@/lib/notification-url", () => ({
  resolveNotificationBaseUrl: (...args: unknown[]) => mocks.resolveNotificationBaseUrl(...args),
}));

// Mock the db module before importing the SUT (pattern from
// actions/master-data.test.ts / actions/device-groups.test.ts): `transaction`
// forwards to its callback with a tx handle that shares the same
// select/insert/update/delete implementations.
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
          onConflictDoNothing: () => {
            mocks.order.push("insert-conflict");
            return resultChain;
          },
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

  const tx = {
    select,
    insert,
    update,
    delete: del,
    // updateChecklist reads the existing items through the tx handle.
    query: { checklistItems: { findMany: mocks.findMany } },
  };
  mocks.tx = tx as unknown as Record<string, unknown>;

  return {
    db: {
      select,
      insert,
      update,
      delete: del,
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      query: {
        checklistEntries: { findFirst: mocks.findFirst, findMany: mocks.findMany },
        checklistItems: { findFirst: mocks.findFirst, findMany: mocks.findMany },
        devices: { findFirst: mocks.findFirst, findMany: mocks.findMany },
        sites: { findFirst: mocks.findFirst },
        users: { findFirst: mocks.findFirst },
      },
    },
  };
});

import { db } from "../db";
import { submitChecklist, updateChecklist, splitTelegramChunks } from "./checklist";

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  query: Record<string, { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }>;
};

const SITE_ID = 7;
const auth = {
  ok: true,
  session: { userId: 1, username: "checker", role: "staff" } as never,
  activeSiteId: SITE_ID,
};

function queueSelect(...results: unknown[][]) {
  mocks.selectResults.push(...results);
}

function queueReturning(...results: unknown[][]) {
  mocks.returningResults.push(...results);
}

function submitForm(deviceIds: number[], statuses: Record<number, "OK" | "NOT OK">, remarks: Record<number, string> = {}) {
  const fd = new FormData();
  fd.set("checkDate", "2026-08-19");
  fd.set("checkTime", "09:00");
  fd.set("shift", "Pagi");
  for (const id of deviceIds) fd.append("deviceId", String(id));
  for (const id of deviceIds) {
    fd.set(`status-${id}`, statuses[id] ?? "OK");
    fd.set(`remarks-${id}`, remarks[id] ?? "");
  }
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
  mocks.requireActiveSiteAction.mockResolvedValue({ ok: false, message: "No active site selected." });
  mocks.hasAdminAccess.mockResolvedValue(false);
  mocks.createIncidentsForChecklistItems.mockResolvedValue([]);
  mocks.getTelegramAlertTemplate.mockResolvedValue(null);
  mocks.validateUpload.mockResolvedValue(null);
  // Default: db.transaction forwards to its callback with the tx handle.
  mockedDb.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(mocks.tx as never));
});

describe("submitChecklist", () => {
  it("rejects unauthenticated/no-site guards without touching the db", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue({ ok: false, message: "No active site selected." });

    const result = await submitChecklist(null, submitForm([], {}));

    expect(result).toEqual({ message: "No active site selected." });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("creates entry + items + incidents inside ONE transaction", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(auth);
    // site validation: both devices belong to the site
    queueSelect([{ id: 1 }, { id: 2 }]);
    queueReturning([{ id: 5 }], [{ id: 7 }], [{ id: 8 }]);
    mocks.createIncidentsForChecklistItems.mockResolvedValue([{ id: 20, checklistItemId: 7 }]);
    // telegram block: no recipients (no chat rows, no legacy chatId)
    mocks.findFirst
      .mockResolvedValueOnce({ id: SITE_ID, name: "DC Test", code: "DC-1", telegramChatId: null })
      .mockResolvedValueOnce({ id: 1, username: "checker" });

    const result = await submitChecklist(null, submitForm([1, 2], { 1: "OK", 2: "NOT OK" }, { 2: "Buzzer sound" }));

    expect(result).toEqual({ success: true });
    // problem: everything inside one transaction
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    // entry inserted with site + user + shift metadata
    expect(mocks.insertValues[0]).toMatchObject({
      siteId: SITE_ID,
      userId: 1,
      checkDate: "2026-08-19",
      shift: "Pagi",
    });
    expect(mocks.insertValues[1]).toMatchObject({ entryId: 5, deviceId: 1, status: "OK" });
    expect(mocks.insertValues[2]).toMatchObject({ entryId: 5, deviceId: 2, status: "NOT OK", remarks: "Buzzer sound" });
    // the item insert is idempotent against the unique (entry_id, device_id)
    expect(mocks.order.filter((op) => op === "insert-conflict").length).toBe(2);
    // incidents created from the NOT-OK item inside the SAME transaction handle
    expect(mocks.createIncidentsForChecklistItems).toHaveBeenCalledTimes(1);
    const [incidentInput, incidentTx] = mocks.createIncidentsForChecklistItems.mock.calls[0] as [unknown, unknown];
    expect((incidentInput as { items: unknown[] }).items).toHaveLength(1);
    expect(incidentTx).toBe(mocks.tx);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "checklist", entityId: 5 }));
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("deduplicates repeated device ids in the form", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(auth);
    queueSelect([{ id: 1 }]);
    queueReturning([{ id: 9 }], [{ id: 10 }]);

    // device 1 appears twice (visible card + hidden block duplicate)
    await submitChecklist(null, submitForm([1, 1], { 1: "OK" }));

    // only ONE item insert after the entry insert
    expect(mocks.insertValues.filter((v) => (v as { deviceId?: number }).deviceId === 1)).toHaveLength(1);
  });

  it("rejects device ids outside the active site and never enters the transaction (finding #44)", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(auth);
    queueSelect([{ id: 1 }]); // device 2 does not belong to the site

    const result = await submitChecklist(null, submitForm([1, 2], { 1: "OK", 2: "OK" }));

    expect(result).toEqual({ message: "Some devices are not valid for the active site. Reload the page and try again." });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
    expect(mocks.order).not.toContain("insert");
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("returns a failure message after rollback when the transaction fails (finding #08)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.requireActiveSiteAction.mockResolvedValue(auth);
    queueSelect([{ id: 1 }]);
    mockedDb.transaction.mockRejectedValue(new Error("connection terminated"));

    const result = await submitChecklist(null, submitForm([1], { 1: "OK" }));

    expect(result).toEqual({ message: "Failed to submit checklist" });
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("updateChecklist (finding #23 — keep rows, reconcile incidents)", () => {
  const entryForm = () => {
    const fd = submitForm([1, 2, 3], { 1: "OK", 2: "OK", 3: "NOT OK" }, { 3: "Buzzer new" });
    fd.set("entryId", "9");
    return fd;
  };

  function stubOwnership() {
    mocks.requireActiveSiteAction.mockResolvedValue(auth);
    mocks.hasAdminAccess.mockResolvedValue(true);
    mocks.findFirst.mockResolvedValueOnce({ id: 9, userId: 1, checkDate: "2026-08-18", shift: "Siang" });
  }

  it("updates existing item rows in place, creates incidents for new NOT-OK, auto-resolves flipped devices", async () => {
    stubOwnership();
    queueSelect([{ id: 1 }, { id: 2 }, { id: 3 }]); // site validation
    mocks.findMany.mockResolvedValueOnce([
      { id: 10, deviceId: 1, status: "NOT OK", remarks: "old", photoPath: null }, // flips to OK
      { id: 11, deviceId: 2, status: "OK", remarks: "", photoPath: null },        // stays OK
    ]);
    queueSelect([{ id: 5, status: "Open" }]); // incident linked to item 10
    queueReturning([{ id: 12 }]); // new item for device 3
    mocks.createIncidentsForChecklistItems.mockResolvedValue([{ id: 30, checklistItemId: 12 }]);

    const result = await updateChecklist(null, entryForm());

    expect(result).toEqual({ success: true, message: "Checklist updated successfully" });
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    // in-place updates instead of delete + re-insert: exactly the two existing rows
    expect(mocks.order.filter((op) => op === "delete")).toHaveLength(0);
    expect(mocks.updateSets).toEqual([
      { checkDate: "2026-08-19", checkTime: "09:00", shift: "Pagi" }, // entry row
      { status: "OK", remarks: "", photoPath: null },                 // item 10 (flipped)
      { status: "OK", remarks: "", photoPath: null },                 // item 11 (unchanged)
      // auto-resolve of the incident on item 10:
      expect.objectContaining({ status: "Resolved", resolutionCategory: "False Alarm" }),
    ]);
    // the new device got an item insert inside the same tx (the later
    // incidentUpdates row is appended after it)
    expect(mocks.insertValues.find((v) => (v as { deviceId?: number }).deviceId === 3)).toMatchObject({
      entryId: 9,
      deviceId: 3,
      status: "NOT OK",
      remarks: "Buzzer new",
    });
    // incidents reconciled for the newly NOT-OK device only (item 12), in tx
    const [incidentInput, incidentTx] = mocks.createIncidentsForChecklistItems.mock.calls[0] as [unknown, unknown];
    expect(incidentInput).toEqual({
      siteId: SITE_ID,
      userId: 1,
      items: [{ checklistItemId: 12, deviceId: 3, status: "NOT OK", remarks: "Buzzer new" }],
    });
    expect(incidentTx).toBe(mocks.tx);
    // the flipped device got an incidentUpdates row documenting the auto-resolve
    expect(mocks.insertValues).toContainEqual(expect.objectContaining({
      incidentId: 5,
      updateType: "status_changed",
      previousStatus: "Open",
      newStatus: "Resolved",
    }));
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "checklist", entityId: 9 }));
  });

  it("deletes rows for devices removed from the entry", async () => {
    stubOwnership();
    queueSelect([{ id: 1 }]);
    mocks.findMany.mockResolvedValueOnce([
      { id: 10, deviceId: 1, status: "NOT OK", remarks: "", photoPath: "/uploads/x.jpg" },
      { id: 11, deviceId: 99, status: "NOT OK", remarks: "", photoPath: "/uploads/y.jpg" }, // gone from the form
    ]);

    const form = submitForm([1], { 1: "OK" });
    form.set("entryId", "9");

    const result = await updateChecklist(null, form);

    expect(result).toEqual({ success: true, message: "Checklist updated successfully" });
    // removed device (99): photo deleted + item deleted; the kept device's
    // photo is untouched
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith("/uploads/y.jpg");
    expect(mocks.deleteUploadFile).not.toHaveBeenCalledWith("/uploads/x.jpg");
    expect(mocks.order.filter((op) => op === "delete")).toHaveLength(1);
    // its incident is NOT auto-resolved (removal says nothing about health);
    // the reconciliation still runs for the (empty) NOT-OK set
    expect(mocks.createIncidentsForChecklistItems).toHaveBeenCalledWith(
      expect.objectContaining({ items: [] }),
      mocks.tx,
    );
  });

  it("rejects a foreign device id before touching the entry (finding #44)", async () => {
    stubOwnership();
    queueSelect([{ id: 1 }]); // device 2 foreign

    const result = await updateChecklist(null, entryForm());

    expect(result).toEqual({ message: "Some devices are not valid for the active site. Reload the page and try again." });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});

describe("splitTelegramChunks", () => {
  it("keeps a short batch as one message", () => {
    expect(splitTelegramChunks(["a", "b", "c"])).toEqual(["a\n\n---\n\nb\n\n---\n\nc"]);
  });

  it("splits on device-block separators when the joined message exceeds 4000 chars", () => {
    const block = "X".repeat(2500);
    const chunks = splitTelegramChunks([block, block, block, block]);
    // 2500 + separator + 2500 > 4000, so every block lands in its own chunk
    expect(chunks.length).toBe(4);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
      // blocks stay intact — the separator is the split point
      expect(chunk).toBe(block);
    }
  });

  it("truncates a single block over the cap and warns (finding #22)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunks = splitTelegramChunks(["X".repeat(5000)]);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(4000);
    expect(chunks[0].endsWith("…")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});