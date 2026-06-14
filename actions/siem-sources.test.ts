import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock action-auth so the SUT does not require a live session. The mocked
// guard always succeeds with a stable activeSiteId=1.
vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAdminAction: async () => ({
    ok: true,
    session: { userId: 1, username: "u", role: "admin" } as never,
    activeSiteId: 1,
  }),
}));

const logAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Build a fluent query chain for `db.query.syslogSources.findFirst` and the
// `db.update / db.delete / db.select` statements. The select().from().where()
// chain resolves to the row array directly (no .limit() in the SUT).
const findFirstMock = vi.fn();
const eventCountSelectFrom = vi.fn();
const eventCountSelectWhere = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const deleteWhereMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    query: { syslogSources: { findFirst: (..._args: unknown[]) => findFirstMock() } },
    select: (..._args: unknown[]) => ({
      from: (..._a: unknown[]) => {
        eventCountSelectFrom(..._a);
        return { where: (..._w: unknown[]) => eventCountSelectWhere(..._w) };
      },
    }),
    update: (..._args: unknown[]) => ({
      set: (..._args: unknown[]) => {
        updateSetMock(..._args);
        return { where: (..._args: unknown[]) => updateWhereMock(..._args) };
      },
    }),
    delete: (..._args: unknown[]) => ({ where: (..._args: unknown[]) => deleteWhereMock(..._args) }),
  },
}));

import { deleteSiemSource } from "./siem-sources";

function makeFormData(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, String(value));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  eventCountSelectWhere.mockResolvedValue([{ count: 0 }]);
  updateWhereMock.mockResolvedValue(undefined);
  deleteWhereMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("deleteSiemSource", () => {
  it("deletes the source and detaches its events when the source belongs to the active site", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 42,
      siteId: 1,
      displayName: "edge-firewall-1",
    });
    eventCountSelectWhere.mockResolvedValue([{ count: 7 }]);

    const result = await deleteSiemSource(undefined, makeFormData({ id: "42" }));

    expect(result).toMatchObject({ success: true });
    expect(eventCountSelectFrom).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({ sourceId: null });
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entity: "syslog_source",
        entityId: 42,
        entityName: "edge-firewall-1",
        detail: expect.stringContaining("Detached 7 events"),
      }),
    );
  });

  it("returns an error when the source is not visible in the active site", async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const result = await deleteSiemSource(undefined, makeFormData({ id: "999" }));

    expect(result).toEqual({ message: "Syslog source not found for active site." });
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(deleteWhereMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid (non-numeric) id without touching the db", async () => {
    const result = await deleteSiemSource(undefined, makeFormData({ id: "abc" }));
    expect(result).toEqual({ message: "Invalid source id." });
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
