import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  requireActiveSiteAdminAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  logAudit: vi.fn(async (): Promise<unknown> => undefined),
  revalidatePath: vi.fn(() => undefined),
  selectQueue: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAction: () => mocks.requireActiveSiteAction(),
  requireActiveSiteAdminAction: () => mocks.requireActiveSiteAdminAction(),
}));

vi.mock("@/lib/audit", () => ({ logAudit: () => mocks.logAudit() }));
vi.mock("next/cache", () => ({ revalidatePath: () => mocks.revalidatePath() }));

vi.mock("@/db", () => {
  function thenable(value: () => unknown[]) {
    const t: Record<string, unknown> = {
      then: (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(value()).then(onFulfilled),
    };
    for (const m of ["where", "orderBy", "limit"] as const) t[m] = () => t;
    return t;
  }
  return {
    db: {
      select: (..._a: unknown[]) => ({ from: () => thenable(() => mocks.selectQueue.shift() ?? []) }),
      update: () => ({ set: (v: Record<string, unknown>) => { mocks.updates.push(v); return { where: () => Promise.resolve(undefined) }; } }),
    },
  };
});

import { getEpdrEndpoints, linkEpdrEndpointToAsset, setEpdrEndpointCritical, setEpdrEndpointNoAuto, unlinkEpdrEndpoint } from "./epdr-endpoints";

function form(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, String(v));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.updates = [];
  mocks.requireActiveSiteAction.mockResolvedValue({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 });
  mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 });
});

describe("epdr-endpoints authorization", () => {
  it("read action rejects when no active site", async () => {
    mocks.requireActiveSiteAction.mockResolvedValueOnce({ ok: false, message: "No active site selected." });
    const result = await getEpdrEndpoints();
    expect(result).toMatchObject({ message: "No active site selected." });
  });

  it("admin mutations reject staff", async () => {
    mocks.requireActiveSiteAdminAction.mockResolvedValueOnce({ ok: false, message: "Unauthorized." });
    const result = await setEpdrEndpointCritical(undefined, form({ endpointId: "1", value: "true" }));
    expect(result).toMatchObject({ message: "Unauthorized." });
  });
});

describe("epdr-endpoints site isolation", () => {
  it("rejects linking an asset from another site", async () => {
    // endpoint query resolves a same-site endpoint, device query resolves none.
    mocks.selectQueue = [[{ siteId: 7 }], []];
    const result = await linkEpdrEndpointToAsset(undefined, form({ endpointId: "5", deviceId: "99" }));
    expect(result).toMatchObject({ message: expect.stringContaining("site yang sama") });
    expect(mocks.updates).toHaveLength(0);
  });

  it("links an endpoint to a same-site asset", async () => {
    mocks.selectQueue = [[{ siteId: 7 }], [{ id: 99 }]];
    const result = await linkEpdrEndpointToAsset(undefined, form({ endpointId: "5", deviceId: "99" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ deviceId: 99 });
  });

  it("refuses to mutate an endpoint that belongs to another site", async () => {
    mocks.selectQueue = [[{ siteId: 3 }]];
    const result = await setEpdrEndpointCritical(undefined, form({ endpointId: "5", value: "true" }));
    expect(result).toMatchObject({ message: expect.stringContaining("tidak ditemukan") });
    expect(mocks.updates).toHaveLength(0);
  });
});

describe("epdr-endpoints admin toggles", () => {
  it("updates is_critical for an admin acting on their own site", async () => {
    mocks.selectQueue = [[{ siteId: 7 }]];
    const result = await setEpdrEndpointCritical(undefined, form({ endpointId: "5", value: "true" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ isCritical: true });
  });

  it("unlinks an endpoint to clear the asset", async () => {
    mocks.selectQueue = [[{ siteId: 7, deviceId: 99 }]];
    const result = await unlinkEpdrEndpoint(undefined, form({ endpointId: "5" }));
    expect(result).toMatchObject({ success: true });
    expect(mocks.updates[0]).toMatchObject({ deviceId: null });
  });
});