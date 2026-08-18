import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAdminAction: vi.fn(),
  checkRackCollision: vi.fn(),
}));

vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: (...args: unknown[]) => mocks.requireActiveSiteAdminAction(...args),
}));

// Keep the real capacity helpers; only mock the collision lookup.
vi.mock("@/lib/rack-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rack-validation")>();
  return { ...actual, checkRackCollision: (...args: unknown[]) => mocks.checkRackCollision(...args) };
});

vi.mock("@/db", () => ({
  db: {
    query: {
      devices: { findFirst: vi.fn() },
      racks: { findFirst: vi.fn() },
    },
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

import { db } from "@/db";
import { POST } from "./route";

const mockedDb = db as unknown as {
  query: {
    devices: { findFirst: ReturnType<typeof vi.fn> };
    racks: { findFirst: ReturnType<typeof vi.fn> };
  };
  update: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

const SITE_ID = 7;

const adminAuth = {
  ok: true,
  session: { userId: 1, username: "admin", role: "admin" } as never,
  activeSiteId: SITE_ID,
};

function post(body: unknown) {
  const req = new Request("http://localhost/api/update-position", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireActiveSiteAdminAction.mockResolvedValue(adminAuth);
  mocks.checkRackCollision.mockResolvedValue([]);
  mockedDb.query.devices.findFirst.mockResolvedValue({
    id: 1,
    name: "FW-01",
    uHeight: 1,
    rackName: null,
    rackPosition: null,
    zone: null,
  });
  mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42, zone: null, name: "Rack A" });
  mockedDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
  mockedDb.transaction.mockImplementation(async (fn: (tx: typeof mockedDb) => unknown) => fn(mockedDb));
});

describe("POST /api/update-position rack capacity (finding #10)", () => {
  it("rejects a placement that overflows the rack's totalU before any collision check", async () => {
    // 41 + 4 - 1 = 44 > 42: the audit's exact multi-U drag-drop overflow scenario
    const res = await post({ deviceId: 1, rackName: "Rack A", rackPosition: 41, uHeight: 4 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Posisi melebihi kapasitas rak (maksimal U42)." });
    expect(mocks.checkRackCollision).not.toHaveBeenCalled();
    expect(mockedDb.update).not.toHaveBeenCalled();
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("rejects a rackPosition below U1", async () => {
    const res = await post({ deviceId: 1, rackName: "Rack A", rackPosition: -1, uHeight: 1 });

    expect(res.status).toBe(400);
    expect(mocks.checkRackCollision).not.toHaveBeenCalled();
  });

  it("accepts a placement within capacity and persists the move", async () => {
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42, zone: "DC-1", name: "Rack A" });
    mocks.checkRackCollision.mockResolvedValue([]);

    const res = await post({ deviceId: 1, rackName: "Rack A", rackPosition: 5, uHeight: 1 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Device position updated" });
    expect(mocks.checkRackCollision).toHaveBeenCalledWith(SITE_ID, "Rack A", 5, 1, 1);
    expect(mockedDb.update).toHaveBeenCalledOnce();
  });

  it("accepts a rack's default totalU when the rack row has none", async () => {
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: null, zone: null, name: "Rack A" });
    const res = await post({ deviceId: 1, rackName: "Rack A", rackPosition: 42, uHeight: 1 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Device position updated" });
  });

  it("rejects a swap when the displaced device would overflow the destination rack", async () => {
    // A 1U device at U41 dropped onto a 4U device at U1-4: B must move to U41
    // with its 4U height, overflowing the 42U rack.
    mockedDb.query.devices.findFirst.mockResolvedValue({
      id: 1,
      name: "FW-01",
      uHeight: 1,
      rackName: "Rack A",
      rackPosition: 41,
      zone: null,
    });
    mockedDb.query.racks.findFirst.mockResolvedValue({ totalU: 42, zone: null, name: "Rack A" });
    mocks.checkRackCollision
      .mockResolvedValueOnce([{ id: 2, name: "SW-02", rackPosition: 1, uHeight: 4 }])
      .mockResolvedValueOnce([]);

    const res = await post({ deviceId: 1, rackName: "Rack A", rackPosition: 1, uHeight: 1 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Posisi melebihi kapasitas rak (maksimal U42)." });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("resolves a case-variant drop to the rack row and stores its canonical name (finding #33)", async () => {
    // The layout merges racks by lowercased name; a drop onto "RACK A" must
    // find the "rack a" row and persist the canonical spelling.
    let findFirstArgs: unknown[] | undefined;
    mockedDb.query.racks.findFirst.mockImplementation((...args: unknown[]) => {
      findFirstArgs = args;
      return Promise.resolve({ totalU: 42, zone: null, name: "rack a" });
    });
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockedDb.update.mockReturnValue({ set: setMock } as never);

    const res = await post({ deviceId: 1, rackName: "RACK A", rackPosition: 5, uHeight: 1 });

    expect(res.status).toBe(200);
    const dialect = new PgDialect();
    const { where } = findFirstArgs?.[0] as { where: unknown };
    const query = dialect.sqlToQuery(where as never);
    expect(query.sql).toContain("lower(");
    expect(query.params).toEqual(expect.arrayContaining([SITE_ID, "RACK A"]));
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ rackName: "rack a" }));
  });
});