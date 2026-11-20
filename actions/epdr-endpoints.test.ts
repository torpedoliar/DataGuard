import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  requireActiveSiteAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  requireActiveSiteAdminAction: vi.fn(async (): Promise<unknown> => ({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 })),
  requireSiteAccess: vi.fn(async () => true),
  logAudit: vi.fn(async (): Promise<unknown> => undefined),
  revalidatePath: vi.fn(() => undefined),
  selectQueue: [] as unknown[][],
  executionSettings: vi.fn(),
  binding: { id: 12, accountRevision: 3, enabled: true, accountId: "account" } as { id: number; accountRevision: number; enabled: boolean; accountId: string } | null,
  updates: [] as Array<Record<string, unknown>>,
  limits: [] as number[],
  offsets: [] as number[],
  predicates: [] as unknown[],
}));

vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAction: () => mocks.requireActiveSiteAction(),
  requireActiveSiteAdminAction: () => mocks.requireActiveSiteAdminAction(),
}));

vi.mock("@/lib/audit", () => ({ logAudit: () => mocks.logAudit() }));
vi.mock("@/lib/site-access", () => ({ hasAdminAccess: async () => true, requireSiteAccess: (...args: unknown[]) => { void args; return mocks.requireSiteAccess(); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => mocks.revalidatePath() }));
vi.mock("@/lib/epdr/execution-store", () => ({ loadExecutionSettings: (...args: unknown[]) => mocks.executionSettings(...args) }));

vi.mock("@/db", () => {
  function thenable(value: () => unknown[]) {
    const t: Record<string, unknown> = {
      then: (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(value()).then(onFulfilled),
    };
    for (const m of ["orderBy", "leftJoin"] as const) t[m] = () => t;
    t.where = (value: unknown) => { mocks.predicates.push(value); return t; };
    t.limit = (value: number) => { mocks.limits.push(value); return t; };
    t.offset = (value: number) => { mocks.offsets.push(value); return t; };
    return t;
  }
  return {
    db: {
      select: (selection: Record<string, unknown>) => ({ from: () => thenable(() =>
        "accountId" in selection
          ? (mocks.binding ? [mocks.binding] : [])
          : mocks.selectQueue.shift() ?? []) }),
      update: () => ({ set: (v: Record<string, unknown>) => { mocks.updates.push(v); return { where: () => Promise.resolve(undefined) }; } }),
    },
  };
});

import { getEpdrEndpointPage, loadSecurityContext, getEpdrEndpoints, linkEpdrEndpointToAsset, setEpdrEndpointCritical, setEpdrEndpointNoAuto, unlinkEpdrEndpoint } from "./epdr-endpoints";

function form(values: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, String(v));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.binding = { id: 12, accountRevision: 3, enabled: true, accountId: "account" };
  mocks.updates = [];
  mocks.limits = [];
  mocks.offsets = [];
  mocks.predicates = [];
  mocks.requireSiteAccess.mockResolvedValue(true);
  mocks.requireActiveSiteAction.mockResolvedValue({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 });
  mocks.requireActiveSiteAdminAction.mockResolvedValue({ ok: true, session: { userId: 1, role: "admin" }, activeSiteId: 7 });
});

describe("epdr-endpoints authorization", () => {
  it("read action rejects when no active site", async () => {
    mocks.requireActiveSiteAction.mockResolvedValueOnce({ ok: false, message: "No active site selected." });
    const result = await getEpdrEndpoints();
    expect(result).toMatchObject({ message: "No active site selected." });
  });

  it("admin mutations reject revoked site membership", async () => {
    mocks.requireSiteAccess.mockResolvedValue(false);
    expect(await setEpdrEndpointCritical(undefined, form({ endpointId: "1", value: "true" }))).toEqual({ message: "Unauthorized." });
    expect(mocks.updates).toHaveLength(0);
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

describe("fleet paging and context guards", () => {
  const input = { page: 1, query: "", filter: "all" as const, group: "", os: "", deviceType: "" as const, sort: "name" as const };

  it("rejects revoked membership before reading inventory", async () => {
    mocks.requireSiteAccess.mockResolvedValue(false);
    expect(await getEpdrEndpointPage(input)).toEqual({ message: "Unauthorized." });
    expect(await getEpdrEndpoints()).toEqual({ message: "Unauthorized." });
  });

  it("does not trust a caller-supplied site or role", async () => {
    await expect(loadSecurityContext(99, "superadmin")).rejects.toThrow("Unauthorized");
  });

  it("reports write mode for the header badge only when every gate is open, failing closed", async () => {
    const open = { globalWritesEnabled: true, siteWritesEnabled: true, globalKillSwitch: false, siteKillSwitch: false, automationPaused: false };
    const connection = { enabled: true, accountId: "account", accountRevision: 3, lastEndpointSyncAt: null, endpointSyncMinutes: 15, lastSyncError: null };
    mocks.selectQueue = [[{ name: "Site" }], [connection]];
    mocks.executionSettings.mockResolvedValueOnce(open);
    expect((await loadSecurityContext(7, "admin")).writeEnabled).toBe(true);
    mocks.selectQueue = [[{ name: "Site" }], [connection]];
    mocks.executionSettings.mockResolvedValueOnce({ ...open, siteKillSwitch: true });
    expect((await loadSecurityContext(7, "admin")).writeEnabled).toBe(false);
    mocks.selectQueue = [[{ name: "Site" }], [connection]];
    mocks.executionSettings.mockRejectedValueOnce(new Error("relation missing"));
    expect((await loadSecurityContext(7, "admin")).writeEnabled).toBe(false);
  });

  it("rejects unbounded or invalid paging inputs", async () => {
    expect(await getEpdrEndpointPage({ ...input, page: 0 })).toEqual({ message: "Invalid fleet filters." });
    expect(await getEpdrEndpointPage({ ...input, query: "x".repeat(81) })).toEqual({ message: "Invalid fleet filters." });
  });

  it.each(["attention", "offline", "outdated", "unlinked", "unknown_contact"] as const)("uses identical site-scoped count/table predicates for %s", async (filter) => {
    mocks.selectQueue = [[{ total: 0 }], []];
    await getEpdrEndpointPage({ ...input, filter, query: "host%_", group: "Production", os: "Linux" });
    const dialect = new PgDialect();
    const count = dialect.sqlToQuery(mocks.predicates[1] as SQL);
    const table = dialect.sqlToQuery(mocks.predicates[2] as SQL);
    expect(table).toEqual(count);
    expect(count.sql).toContain('"epdr_endpoints"."site_id"');
    expect(count.sql).toContain('"epdr_endpoints"."removed_at" is null');
    expect(count.sql).toContain('"epdr_endpoints"."connection_id"');
    expect(count.sql).toContain('"epdr_endpoints"."account_revision"');
    expect(count.params.slice(0, 3)).toEqual([7, 12, 3]);
    expect(count.params).toContain(String.raw`%host\%\_%`);
    expect(count.params).toContain("Production");
    expect(count.params).toContain("Linux");
  });

  it("applies the device type filter to both count and table reads", async () => {
    mocks.selectQueue = [[{ total: 0 }], []];
    await getEpdrEndpointPage({ ...input, deviceType: "3" });
    const dialect = new PgDialect();
    const count = dialect.sqlToQuery(mocks.predicates[1] as SQL);
    const table = dialect.sqlToQuery(mocks.predicates[2] as SQL);
    expect(table).toEqual(count);
    expect(count.sql).toContain('"epdr_endpoints"."device_type" = $4');
    expect(count.params).toContain(3);
  });

  it("rejects an invalid device type value", async () => {
    expect(await getEpdrEndpointPage({ ...input, deviceType: "9" as never })).toEqual({ message: "Invalid fleet filters." });
  });

  it.each([null, { id: 12, accountRevision: 3, enabled: false, accountId: "account" },
    { id: 12, accountRevision: 3, enabled: true, accountId: "" },
    { id: 12, accountRevision: 3, enabled: true, accountId: "   " }])("returns empty current fleet without a usable binding %#", async (binding) => {
    mocks.binding = binding;
    mocks.selectQueue = [[{ name: "Site" }], [{ id: 99, hostName: "historical" }]];
    expect(await getEpdrEndpointPage({ ...input, page: 8 })).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
    const overview = await getEpdrEndpoints();
    expect(overview).toMatchObject({ endpoints: [], posture: { total: 0 } });
    // Only context consumes a queued row: historical inventory was never queried.
    expect(mocks.selectQueue).toEqual([[{ id: 99, hostName: "historical" }]]);
    expect(mocks.offsets).toEqual([]);
  });

  it("scopes overview inventory to the explicit connection and revision", async () => {
    mocks.selectQueue = [[{ name: "Site" }], []];
    await getEpdrEndpoints();
    const compiled = new PgDialect().sqlToQuery(mocks.predicates.at(-1) as SQL);
    expect(compiled.sql).toContain('"epdr_endpoints"."connection_id"');
    expect(compiled.sql).toContain('"epdr_endpoints"."account_revision"');
    expect(compiled.params).toEqual([7, 12, 3]);
  });

  it("can reach records beyond 300 using a bounded database offset", async () => {
    mocks.selectQueue = [[{ total: 607 }], []];
    expect(await getEpdrEndpointPage({ ...input, page: 8 })).toMatchObject({ total: 607, page: 8, pageSize: 50 });
    expect(mocks.limits).toEqual([1, 50]);
    expect(mocks.offsets).toEqual([350]);
  });

  it("returns an explicit total and clamps a page beyond the final page", async () => {
    mocks.selectQueue = [[{ total: 51 }], []];
    expect(await getEpdrEndpointPage({ ...input, page: 100 })).toEqual({ rows: [], total: 51, page: 2, pageSize: 50 });
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