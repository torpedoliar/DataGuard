import { describe, expect, it, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { rackCapacityErrorMessage, rackPlacementExceedsCapacity, rackRangesOverlap, checkRackCollision } from "./rack-validation";

const dbMocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("../db", () => ({
  db: {
    query: {
      devices: { findMany: (...args: unknown[]) => dbMocks.findMany(...args) },
    },
  },
}));

const dialect = new PgDialect();

describe("rackRangesOverlap", () => {
  it("detects overlapping U ranges", () => {
    expect(
      rackRangesOverlap(
        { rackPosition: 10, uHeight: 2 },
        { rackPosition: 11, uHeight: 1 },
      ),
    ).toBe(true);
  });

  it("allows adjacent U ranges", () => {
    expect(
      rackRangesOverlap(
        { rackPosition: 10, uHeight: 2 },
        { rackPosition: 12, uHeight: 1 },
      ),
    ).toBe(false);
  });
});

describe("rackPlacementExceedsCapacity", () => {
  it("allows a placement that ends exactly at the top U", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 40, uHeight: 3, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 1, totalU: 42 })).toBe(false);
  });

  it("rejects a placement that overflows past the top U", () => {
    // 41 + 4 - 1 = 44 > 42: the audit's exact drag-drop overflow scenario
    expect(rackPlacementExceedsCapacity({ rackPosition: 41, uHeight: 4, totalU: 42 })).toBe(true);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 2, totalU: 42 })).toBe(true);
  });

  it("rejects positions below U1", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 0, uHeight: 1, totalU: 42 })).toBe(true);
    expect(rackPlacementExceedsCapacity({ rackPosition: -3, uHeight: 1, totalU: 42 })).toBe(true);
  });

  it("allows U1 as the bottom row", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 1, uHeight: 1, totalU: 42 })).toBe(false);
  });

  it("treats a missing rack position as 'no placement' and always fits", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: null, uHeight: 4, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: undefined, uHeight: 4, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: "", uHeight: 4, totalU: 42 })).toBe(false);
  });

  it("defaults a missing totalU to 42U, mirroring the client U list", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 1 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 4 })).toBe(true);
  });

  it("defaults a missing or zero uHeight to 1U", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: null, totalU: 42 })).toBe(false);
    expect(rackPlacementExceedsCapacity({ rackPosition: 42, uHeight: 0, totalU: 42 })).toBe(false);
  });

  it("coerces string numeric inputs from JSON bodies", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: "41", uHeight: "4", totalU: "42" })).toBe(true);
    expect(rackPlacementExceedsCapacity({ rackPosition: "38", uHeight: "4", totalU: "42" })).toBe(false);
  });

  it("rejects non-numeric positions fail-closed", () => {
    expect(rackPlacementExceedsCapacity({ rackPosition: "abc", uHeight: 1, totalU: 42 })).toBe(true);
  });
});

describe("rackCapacityErrorMessage", () => {
  it("reports the rack capacity in Indonesian", () => {
    expect(rackCapacityErrorMessage(42)).toBe("Posisi melebihi kapasitas rak (maksimal U42).");
    expect(rackCapacityErrorMessage(48)).toBe("Posisi melebihi kapasitas rak (maksimal U48).");
  });

  it("falls back to 42U when the rack has no totalU", () => {
    expect(rackCapacityErrorMessage(null)).toBe("Posisi melebihi kapasitas rak (maksimal U42).");
    expect(rackCapacityErrorMessage(undefined)).toBe("Posisi melebihi kapasitas rak (maksimal U42).");
  });
});

describe("checkRackCollision (finding #33 case-normalized lookup)", () => {
  beforeEach(() => {
    dbMocks.findMany.mockReset();
    dbMocks.findMany.mockResolvedValue([]);
  });

  it("matches devices by lowercased rack name, like getRackLayout's merge key", async () => {
    await checkRackCollision(7, "Rack A", 3, 2);

    const [args] = dbMocks.findMany.mock.calls[0];
    const { where } = args as { where: unknown };
    const query = dialect.sqlToQuery(where as never);

    // Both sides of the name comparison must go through lower() so a
    // case-variant ('rack a') still collides with the rendered rack, and the
    // site must stay site-scoped.
    expect(query.sql).toContain("lower(");
    expect(query.sql).toMatch(/lower\([^)]*\) = lower\(\$\d\)/i);
    expect(query.params).toEqual(expect.arrayContaining([7, "Rack A"]));
  });

  it("reports devices sharing the same case-insensitive rack as collisions", async () => {
    dbMocks.findMany.mockResolvedValue([
      { id: 9, name: "SW-09", rackPosition: 4, uHeight: 1 },
    ]);

    const collisions = await checkRackCollision(1, "rack a", 3, 2);

    expect(collisions).toEqual([{ id: 9, name: "SW-09", rackPosition: 4, uHeight: 1 }]);
    expect(dbMocks.findMany).toHaveBeenCalledOnce();
  });
});
