import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), set: vi.fn(), resolve: vi.fn(), sync: vi.fn() }));
vi.mock("@/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: mocks.select }) }) }),
  update: () => ({ set: (values: unknown) => { mocks.set(values); return { where: async () => undefined }; } }),
} }));
vi.mock("@/lib/database-url", () => ({ buildDatabaseUrl: () => { throw new Error("unexpected DB access"); } }));
vi.mock("@/lib/watchguard/connection", () => ({ resolveWatchGuardConnection: mocks.resolve }));
vi.mock("@/lib/watchguard/client", () => ({ createWatchGuardClient: () => ({}) }));
vi.mock("./sync", () => ({ syncEndpoints: mocks.sync }));
import { EPDR_JOBS } from "./jobs";

const run = (id = 1) => EPDR_JOBS.find((job) => job.name === "endpoints")!.run(id);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockResolvedValue([{ id: 1, siteId: 1, enabled: true }]);
  mocks.resolve.mockResolvedValue({ ok: true, credentials: {}, credentialRevision: 1 });
});

describe("endpoint job outcomes (mock DB only)", () => {
  it("persists credential-resolution failure and fails the worker job", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, reason: "not_configured" });
    await expect(run()).rejects.toThrow("endpoint_sync_failed");
    expect(mocks.set.mock.calls[0]?.[0]).toMatchObject({ lastSyncError: "connection_not_configured" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it.each(["partial", "failed"])("propagates %s sync without advancing success time", async (status) => {
    mocks.sync.mockResolvedValue({ status });
    await expect(run()).rejects.toThrow("endpoint_sync_failed");
    for (const [values] of mocks.set.mock.calls) expect(values).not.toHaveProperty("lastEndpointSyncAt");
  });

  it.each(["ok", "skipped_locked"])("does not report %s as a failed job", async (status) => {
    mocks.sync.mockResolvedValue({ status });
    await expect(run()).resolves.toBeUndefined();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
