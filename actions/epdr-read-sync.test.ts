import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), enqueue: vi.fn(), status: vi.fn(), cancel: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({
  enqueueReadSync: mocks.enqueue, readSyncStatus: mocks.status, cancelReadSync: mocks.cancel,
  emptyReadSyncStatus: (status: string) => ({ status, requestId: null, requestedAt: null, startedAt: null,
    finishedAt: null, retryAt: null, error: null }),
}));
import { requestEpdrReadSync, getEpdrReadSyncStatus, cancelEpdrReadSync } from "./epdr-read-sync";
beforeEach(() => { vi.resetAllMocks(); mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } }); });
describe("endpoint read-sync server actions", () => {
  it("never accepts a client site id and delegates only to the admin active site", async () => {
    mocks.enqueue.mockResolvedValue({ status: "queued", requestId: 4 });
    await expect(requestEpdrReadSync()).resolves.toEqual({ status: "queued", requestId: 4 });
    expect(mocks.enqueue).toHaveBeenCalledWith(17, 9);
    expect(mocks.audit).toHaveBeenNthCalledWith(1, {
      action: "CREATE", entity: "settings", entityId: 17, entityName: "epdr_read_sync",
      detail: "siteId=17;requestId=4;outcome=queued",
    });
    await getEpdrReadSyncStatus();
    expect(mocks.status).toHaveBeenCalledWith(17);
    await cancelEpdrReadSync();
    expect(mocks.cancel).toHaveBeenCalledWith(17);
    expect(mocks.audit).toHaveBeenNthCalledWith(2, {
      action: "UPDATE", entity: "settings", entityId: 17, entityName: "epdr_read_sync",
      detail: "siteId=17;operation=cancel_pending",
    });
  });
  it("denies non-admin callers before accessing the queue", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "denied" });
    expect(await requestEpdrReadSync()).toEqual({ status: "unavailable", reason: "forbidden" });
    expect((await getEpdrReadSyncStatus()).status).toBe("unavailable");
    expect(await cancelEpdrReadSync()).toEqual({ status: "unavailable" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("does not expose raw storage errors or fabricate success", async () => {
    mocks.enqueue.mockRejectedValue(new Error("private"));
    mocks.status.mockRejectedValue(new Error("private"));
    expect(await requestEpdrReadSync()).toEqual({ status: "unavailable", reason: "internal_error" });
    expect((await getEpdrReadSyncStatus()).status).toBe("unavailable");
  });
});
