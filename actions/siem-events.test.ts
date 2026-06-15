import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock action-auth to control superadmin guard.
const requireSuperadminMock = vi.fn();
vi.mock("@/lib/action-auth", () => ({
  requireSuperadminAction: (..._args: unknown[]) => requireSuperadminMock(),
}));

const logAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Build a fluent query chain for the batched DELETE. The select().from().where().limit()
// chain returns IDs and the delete().where() returns row count.
const selectFromMock = vi.fn();
const selectWhereMock = vi.fn();
const selectLimitMock = vi.fn();
const deleteWhereMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (..._args: unknown[]) => ({
      from: (..._a: unknown[]) => {
        selectFromMock(..._a);
        return {
          where: (..._w: unknown[]) => {
            selectWhereMock(..._w);
            return { limit: (..._l: unknown[]) => selectLimitMock(..._l) };
          },
        };
      },
    }),
    delete: (..._args: unknown[]) => ({ where: (..._args: unknown[]) => deleteWhereMock(..._args) }),
    transaction: (..._args: unknown[]) => transactionMock(..._args),
  },
}));

import { pruneEventsBefore } from "./siem-events";

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperadminMock.mockResolvedValue({
    ok: true,
    session: { userId: 1, username: "root", role: "superadmin" } as never,
    activeSiteId: 0,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("pruneEventsBefore", () => {
  it("returns ok=true and deletion counts when given a valid date", async () => {
    // First batch returns 5 ids, second batch returns 0 (stop).
    selectLimitMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    // The delete().where() call returns a row count for the batch.
    deleteWhereMock.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    // For the orphan raw events delete (rawEventsOnly: false is default, so skipped).

    const result = await pruneEventsBefore("2025-01-01");

    expect(result.ok).toBe(true);
    expect(result.deletedEvents).toBeGreaterThanOrEqual(0);
    expect(typeof result.cutoffDate).toBe("string");
    expect(result.cutoffDate).toBe("2025-01-01");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entity: "syslog_event",
        detail: expect.stringContaining("2025-01-01"),
      }),
    );
  });

  it("returns ok=false when the date string is invalid", async () => {
    const result = await pruneEventsBefore("not-a-date");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Invalid date");
    expect(selectFromMock).not.toHaveBeenCalled();
    expect(deleteWhereMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
