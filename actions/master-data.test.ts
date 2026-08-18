import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAction: vi.fn(),
  requireActiveSiteAdminAction: vi.fn(),
  deleteUploadFile: vi.fn(),
  revalidatePath: vi.fn(),
  logAudit: vi.fn(),
  checkRackCollision: vi.fn(),
  rackPlacementExceedsCapacity: vi.fn(),
}));

vi.mock("../lib/action-auth", () => ({
  requireActiveSiteAction: (...args: unknown[]) => mocks.requireActiveSiteAction(...args),
  requireActiveSiteAdminAction: (...args: unknown[]) => mocks.requireActiveSiteAdminAction(...args),
}));

vi.mock("../lib/session", () => ({ verifySession: vi.fn() }));
vi.mock("../lib/site-access", () => ({ hasAdminAccess: vi.fn() }));
vi.mock("../lib/rack-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/rack-validation")>();
  return {
    checkRackCollision: (...args: unknown[]) => mocks.checkRackCollision(...args),
    rackPlacementExceedsCapacity: (...args: unknown[]) => mocks.rackPlacementExceedsCapacity(...args),
    rackCapacityErrorMessage: actual.rackCapacityErrorMessage,
  };
});
vi.mock("../lib/upload", () => ({
  saveUploadFile: vi.fn(),
  deleteUploadFile: (...args: unknown[]) => mocks.deleteUploadFile(...args),
}));
vi.mock("../lib/audit", () => ({ logAudit: (...args: unknown[]) => mocks.logAudit(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));

// Mock the db module before importing the SUT. `transaction` forwards to its
// callback with the same mocked handle, so the code under test runs inside a
// "transaction" against the same chain (pattern from lib/siem/evidence.test.ts).
vi.mock("../db", () => ({
  db: {
    query: {
      devices: { findFirst: vi.fn() },
      racks: { findFirst: vi.fn() },
      checklistItems: { findMany: vi.fn() },
    },
    $count: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

import { db } from "../db";
import { addDevice, deleteDevice, getDeviceDeletionUsage, updateDevice } from "./master-data";
import {
  checklistItems,
  devices,
  devicePics,
  incidents,
  networkPorts,
  siemEvidenceEvents,
  siemFindings,
  syslogEvents,
  syslogSources,
} from "../db/schema";

const mockedDb = db as unknown as {
  query: {
    devices: { findFirst: ReturnType<typeof vi.fn> };
    racks: { findFirst: ReturnType<typeof vi.fn> };
    checklistItems: { findMany: ReturnType<typeof vi.fn> };
  };
  $count: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

const dialect = new PgDialect();

const DEVICE_ID = 42;
const SITE_ID = 7;

const deviceRow = {
  id: DEVICE_ID,
  name: "FW-01",
  photoPath: "devices/fw01-photo.jpg",
};

const readAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: SITE_ID,
};

const adminAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: SITE_ID,
};

type DependencySeed = Partial<{
  checklistItems: number;
  incidents: number;
  networkPorts: number;
  linkedNetworkPorts: number;
  syslogSources: number;
  syslogEvents: number;
  siemFindings: number;
  siemEvidenceEvents: number;
  devicePics: number;
}>;

// The collector counts dependencies with Promise.all in this exact order:
// checklistItems, incidents, networkPorts (own), networkPorts (linked),
// syslogSources, syslogEvents, siemFindings, siemEvidenceEvents, devicePics.
const EXPECTED_COUNT_ORDER = [
  checklistItems,
  incidents,
  networkPorts,
  networkPorts,
  syslogSources,
  syslogEvents,
  siemFindings,
  siemEvidenceEvents,
  devicePics,
];

function mockDependencyCounts(counts: DependencySeed) {
  const queue: number[] = [
    counts.checklistItems ?? 0,
    counts.incidents ?? 0,
    counts.networkPorts ?? 0,
    counts.linkedNetworkPorts ?? 0,
    counts.syslogSources ?? 0,
    counts.syslogEvents ?? 0,
    counts.siemFindings ?? 0,
    counts.siemEvidenceEvents ?? 0,
    counts.devicePics ?? 0,
  ];
  mockedDb.$count.mockImplementation(() => Promise.resolve(queue.shift() ?? 0));
}

function expectCountTargetsAllNine() {
  expect(mockedDb.$count).toHaveBeenCalledTimes(9);
  const targets = mockedDb.$count.mock.calls.map((call) => call[0]);
  expect(targets).toEqual(EXPECTED_COUNT_ORDER);
  // Every dependency predicate is scoped to the device id.
  for (const call of mockedDb.$count.mock.calls) {
    expect(dialect.sqlToQuery(call[1] as never).params).toEqual([DEVICE_ID]);
  }
}

function expectNoMutationNorSideEffects() {
  expect(mockedDb.delete).not.toHaveBeenCalled();
  expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
  expect(mocks.logAudit).not.toHaveBeenCalled();
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: db.transaction forwards to its callback, sharing the underlying
  // mocked handle. Tests override mockImplementation when they need the
  // transaction itself to fail.
  mockedDb.transaction.mockImplementation(async (fn: (tx: typeof mockedDb) => unknown) => fn(mockedDb));
  mockedDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockedDb.$count.mockResolvedValue(0);
  mockedDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  mockedDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
  mocks.requireActiveSiteAction.mockResolvedValue({ ok: false, message: "Unauthorized." });
  mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: false, message: "Unauthorized." });
  mocks.deleteUploadFile.mockResolvedValue(true);
  mocks.checkRackCollision.mockResolvedValue([]);
  mocks.rackPlacementExceedsCapacity.mockReturnValue(false);
});

describe("getDeviceDeletionUsage (read-only preflight)", () => {
  it.each([
    { message: "Unauthorized." },
    { message: "No active site selected." },
  ])("rejects $message without any query", async (failure) => {
    mocks.requireActiveSiteAction.mockResolvedValue(failure);

    await expect(getDeviceDeletionUsage(DEVICE_ID)).resolves.toEqual({ success: false, message: failure.message });

    expect(mockedDb.query.devices.findFirst).not.toHaveBeenCalled();
    expect(mockedDb.$count).not.toHaveBeenCalled();
    expect(mockedDb.query.checklistItems.findMany).not.toHaveBeenCalled();
    expectNoMutationNorSideEffects();
  });

  it("reports a missing device without counting dependencies", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(readAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(undefined);

    await expect(getDeviceDeletionUsage(DEVICE_ID))
      .resolves.toEqual({ success: false, message: "Perangkat tidak ditemukan di site aktif." });

    expect(mockedDb.$count).not.toHaveBeenCalled();
    expectNoMutationNorSideEffects();
  });

  it("reports a zero-dependency device as deletable and never deletes anything, even with no checklist items", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(readAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(deviceRow);

    const result = await getDeviceDeletionUsage(DEVICE_ID);

    expect(result).toMatchObject({
      success: true,
      deviceId: DEVICE_ID,
      deviceName: "FW-01",
      canDelete: true,
      blockingCount: 0,
      checklistPreview: [],
    });
    expect((result as { message: string }).message).toContain("dapat dihapus");
    expectCountTargetsAllNine();
    // Never a delete, photo removal, cache revalidation, or audit write.
    expect(mockedDb.query.checklistItems.findMany).not.toHaveBeenCalled();
    expectNoMutationNorSideEffects();
  });

  it("surfaces checklist history with a preview and deletes nothing", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(readAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(deviceRow);
    mockDependencyCounts({ checklistItems: 2 });
    mockedDb.query.checklistItems.findMany.mockResolvedValue([
      { id: 101, entry: { checkDate: "2026-08-18", checkTime: "07:30", user: { username: "operator" } } },
      { id: 102, entry: { checkDate: "2026-08-17", checkTime: "19:00", user: { username: "pic-01" } } },
    ]);

    const result = await getDeviceDeletionUsage(DEVICE_ID);

    expect(result).toMatchObject({
      success: true,
      canDelete: false,
      blockingCount: 2,
      dependencies: { checklistItems: 2, incidents: 0, devicePics: 0 },
      checklistPreview: [
        { date: "2026-08-18", time: "07:30", user: "operator" },
        { date: "2026-08-17", time: "19:00", user: "pic-01" },
      ],
    });
    expect(mockedDb.query.checklistItems.findMany).toHaveBeenCalledTimes(1);
    const previewWhere = mockedDb.query.checklistItems.findMany.mock.calls[0][0] as { where: unknown };
    expect(dialect.sqlToQuery(previewWhere.where as never).params).toEqual([DEVICE_ID]);
    expectCountTargetsAllNine();
    expectNoMutationNorSideEffects();
  });

  it("detects ports, linked ports, and the syslog/SIEM families as blockers (device_pics is cascade, not a blocker)", async () => {
    mocks.requireActiveSiteAction.mockResolvedValue(readAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(deviceRow);
    mockDependencyCounts({
      networkPorts: 2,
      linkedNetworkPorts: 1,
      syslogSources: 1,
      syslogEvents: 3,
      siemFindings: 2,
      siemEvidenceEvents: 5,
      devicePics: 4,
    });

    const result = await getDeviceDeletionUsage(DEVICE_ID);

    expect(result).toMatchObject({
      success: true,
      canDelete: false,
      // 2 + 1 + 1 + 3 + 2 + 5 = 14; devicePics (cascade) excluded.
      blockingCount: 14,
      dependencies: {
        networkPorts: 2,
        linkedNetworkPorts: 1,
        syslogSources: 1,
        syslogEvents: 3,
        siemFindings: 2,
        siemEvidenceEvents: 5,
        devicePics: 4,
      },
    });
    expectCountTargetsAllNine();
    // Port 1 + linked port 1: both network_ports predicates were scoped to the id
    // in separate calls (the linked predicate is the 4th $count call).
    const linkedPredicate = mockedDb.$count.mock.calls[3][1] as never;
    expect(dialect.sqlToQuery(linkedPredicate).params).toEqual([DEVICE_ID]);
    expectNoMutationNorSideEffects();
  });
});

describe("deleteDevice (history-preserving real delete)", () => {
  it.each([
    { message: "Unauthorized." },
    { message: "No active site selected." },
  ])("rejects $message with no transaction, no mutation, and no filesystem delete", async (failure) => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(failure);

    await expect(deleteDevice(DEVICE_ID, "test reason")).resolves.toEqual({ message: failure.message });

    expect(mockedDb.transaction).not.toHaveBeenCalled();
    expect(mockedDb.query.devices.findFirst).not.toHaveBeenCalled();
    expect(mockedDb.$count).not.toHaveBeenCalled();
    expectNoMutationNorSideEffects();
  });

  it("blocks a device with checklist + incident history inside the transaction and preserves everything", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(deviceRow);
    mockDependencyCounts({ checklistItems: 1, incidents: 1 });

    const result = await deleteDevice(DEVICE_ID, "Replaced by FW-02");

    // The action returns a usage-block shape, not a success.
    expect(result).toMatchObject({ blockingCount: 2 });
    expect((result as { message: string }).message).toContain("tidak dapat dihapus");
    // The tx ran: device re-read + all nine dependency counts happened inside it.
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockedDb.query.devices.findFirst).toHaveBeenCalledTimes(1);
    expectCountTargetsAllNine();
    // No DELETE checklist_items, no DELETE devices, no photo removal, no audit:
    // the checklist item, the incident.checklistItemId link, the device, and
    // the photo are all preserved.
    expectNoMutationNorSideEffects();
  });

  it("blocks when only ports / linked ports / syslog or SIEM references exist and surfaces the count", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(deviceRow);
    mockDependencyCounts({ linkedNetworkPorts: 1, siemEvidenceEvents: 3 });

    const result = await deleteDevice(DEVICE_ID, "test reason");

    expect(result).toMatchObject({ blockingCount: 4 });
    expect(mockedDb.delete).not.toHaveBeenCalled();
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
    expectCountTargetsAllNine();
  });

  it("deletes only the device row for a zero-dependency device and removes the photo / audit / cache AFTER commit", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(deviceRow);

    // Hold the device DELETE unresolved so we can observe the commit boundary.
    let resolveDelete!: (v: unknown) => void;
    const deleteBlocker = new Promise((resolve) => { resolveDelete = resolve; });
    const deleteWhere = vi.fn().mockReturnValue(deleteBlocker);
    mockedDb.delete.mockReturnValue({ where: deleteWhere });

    const pending = deleteDevice(DEVICE_ID, "Decommissioned FW-01");
    await tick();

    // The database transaction has NOT committed yet: no photo deletion, no
    // cache revalidation, no audit log.
    expect(mockedDb.delete).toHaveBeenCalledWith(devices);
    expect(dialect.sqlToQuery(deleteWhere.mock.calls[0][0] as never).params).toEqual([DEVICE_ID, SITE_ID]);
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();

    resolveDelete(undefined);
    const result = await pending;

    expect(result).toEqual({ success: true });
    // The device re-read inside the tx was site-scoped.
    const findFirstArgs = mockedDb.query.devices.findFirst.mock.calls[0][0] as { where: unknown; columns: { photoPath: boolean } };
    expect(dialect.sqlToQuery(findFirstArgs.where as never).params).toEqual([DEVICE_ID, SITE_ID]);
    expect(findFirstArgs.columns.photoPath).toBe(true);
    expectCountTargetsAllNine();
    // Only after commit: photo removed, caches revalidated, audit written.
    expect(mocks.deleteUploadFile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteUploadFile).toHaveBeenCalledWith("devices/fw01-photo.jpg");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "DELETE",
      entity: "device",
      entityId: DEVICE_ID,
      entityName: "FW-01",
      detail: "Reason: Decommissioned FW-01",
    }));
  });

  it("deletes a device whose only reference is device_pics (FK cascade, not a blocker)", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue({ ...deviceRow, photoPath: null });
    mockDependencyCounts({ devicePics: 3 });

    const result = await deleteDevice(DEVICE_ID, "No history, only PIC bindings");

    expect(result).toEqual({ success: true });
    expect(mockedDb.delete).toHaveBeenCalledWith(devices);
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", entityId: DEVICE_ID }));
  });

  it("returns a missing-device result and deletes nothing when the device vanishes inside the transaction", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue(undefined);

    await expect(deleteDevice(DEVICE_ID, "test reason"))
      .resolves.toEqual({ message: "Perangkat tidak ditemukan di site aktif." });

    expect(mockedDb.$count).not.toHaveBeenCalled();
    expectNoMutationNorSideEffects();
  });

  it("does not delete photos or history when the transaction fails on an FK violation (race guard)", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.transaction.mockRejectedValue(
      new Error('insert or update on table "incidents" violates foreign key constraint "incidents_device_id_devices_id_fk"'),
    );

    const result = await deleteDevice(DEVICE_ID, "test reason");

    expect((result as { message: string }).message).toContain("data terkait baru muncul");
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("returns a fatal message on a generic transaction failure without any side effect", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.transaction.mockRejectedValue(new Error("connection terminated"));

    const result = await deleteDevice(DEVICE_ID, "test reason");

    expect(result).toEqual({ message: "Terjadi kesalahan fatal saat menghapus perangkat. Coba lagi perlahan." });
    expect(mocks.deleteUploadFile).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});

describe("addDevice / updateDevice rack capacity (finding #10)", () => {
  function rackFormData(overrides: { name?: string; rackPosition?: string; uHeight?: string } = {}) {
    const fd = new FormData();
    fd.set("name", overrides.name ?? "FW-01");
    fd.set("categoryId", "1");
    fd.set("locationId", "1");
    fd.set("rackName", "Rack A");
    if (overrides.rackPosition !== undefined) fd.set("rackPosition", overrides.rackPosition);
    if (overrides.uHeight !== undefined) fd.set("uHeight", overrides.uHeight);
    return fd;
  }

  it("addDevice rejects a placement exceeding totalU before any collision check or insert", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42 });
    mocks.rackPlacementExceedsCapacity.mockReturnValue(true);

    const result = await addDevice(null, rackFormData({ rackPosition: "41", uHeight: "4" }));

    expect(result).toEqual({ message: "Posisi melebihi kapasitas rak (maksimal U42)." });
    expect(mockedDb.query.racks.findFirst).toHaveBeenCalledOnce();
    expect(mocks.rackPlacementExceedsCapacity).toHaveBeenCalledWith({ rackPosition: 41, uHeight: 4, totalU: 42 });
    expect(mocks.checkRackCollision).not.toHaveBeenCalled();
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("addDevice rejects a fractional uHeight (0.5U) with a validation error before any DB call (finding #32)", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);

    const result = await addDevice(null, rackFormData({ rackPosition: "10", uHeight: "0.5" }));

    expect(result).toHaveProperty("errors");
    expect((result as { errors: Record<string, unknown[]> }).errors).toHaveProperty("uHeight");
    expect(mockedDb.query.racks.findFirst).not.toHaveBeenCalled();
    expect(mocks.checkRackCollision).not.toHaveBeenCalled();
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("addDevice allows a placement within totalU and proceeds with the insert", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42 });
    mocks.rackPlacementExceedsCapacity.mockReturnValue(false);
    mocks.checkRackCollision.mockResolvedValue([]);

    const result = await addDevice(null, rackFormData({ rackPosition: "38", uHeight: "4" }));

    expect(result).toEqual({ success: true, message: "Device added successfully" });
    expect(mocks.rackPlacementExceedsCapacity).toHaveBeenCalledWith({ rackPosition: 38, uHeight: 4, totalU: 42 });
    expect(mocks.checkRackCollision).toHaveBeenCalledWith(SITE_ID, "Rack A", 38, 4);
    expect(mockedDb.insert).toHaveBeenCalledOnce();
  });

  it("updateDevice rejects a move exceeding totalU using the stored uHeight when the form omits it", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue({ id: DEVICE_ID, name: "FW-01", uHeight: 5, photoPath: null });
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42 });
    mocks.rackPlacementExceedsCapacity.mockReturnValue(true);

    const fd = rackFormData({ rackPosition: "41" });
    fd.set("id", String(DEVICE_ID));
    // no uHeight field: must fall back to existingDevice.uHeight (5)

    const result = await updateDevice(null, fd);

    expect(result).toEqual({ message: "Posisi melebihi kapasitas rak (maksimal U42)." });
    expect(mocks.rackPlacementExceedsCapacity).toHaveBeenCalledWith({ rackPosition: 41, uHeight: 5, totalU: 42 });
    expect(mocks.checkRackCollision).not.toHaveBeenCalled();
    expect(mockedDb.update).not.toHaveBeenCalled();
  });

  it("updateDevice allows a move within totalU and proceeds with the update", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
    mockedDb.query.devices.findFirst.mockResolvedValue({ id: DEVICE_ID, name: "FW-01", uHeight: 1, photoPath: null });
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42 });
    mocks.rackPlacementExceedsCapacity.mockReturnValue(false);
    mocks.checkRackCollision.mockResolvedValue([]);

    const fd = rackFormData({ rackPosition: "5", uHeight: "1" });
    fd.set("id", String(DEVICE_ID));

    const result = await updateDevice(null, fd);

    expect(result).toEqual({ success: true, message: "Device updated successfully" });
    expect(mocks.rackPlacementExceedsCapacity).toHaveBeenCalledWith({ rackPosition: 5, uHeight: 1, totalU: 42 });
    expect(mocks.checkRackCollision).toHaveBeenCalledWith(SITE_ID, "Rack A", 5, 1, DEVICE_ID);
    expect(mockedDb.update).toHaveBeenCalledOnce();
  });
});