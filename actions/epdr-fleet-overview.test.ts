import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), access: vi.fn(), adminAccess: vi.fn(),
  selectQueue: [] as unknown[][], execute: vi.fn(),
}));

vi.mock("@/lib/action-auth", () => ({
  requireActiveSiteAction: mocks.guard, requireActiveSiteAdminAction: mocks.guard,
}));
vi.mock("@/lib/site-access", () => ({
  requireSiteAccess: mocks.access, hasAdminAccess: mocks.adminAccess,
}));
vi.mock("@/db", () => {
  function select() {
    const thenable: Record<string, unknown> = {
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(mocks.selectQueue.shift() ?? []).then(resolve),
    };
    thenable.from = () => thenable;
    thenable.where = () => thenable;
    thenable.limit = () => thenable;
    return thenable;
  }
  return { db: { select, execute: mocks.execute } };
});

import { getEpdrFleetOverview } from "./epdr-endpoints";

const connection = {
  enabled: true, lastEndpointSyncAt: new Date(), endpointSyncMinutes: 15,
  lastSyncError: null, accountId: "acct", accountRevision: 3,
};
const binding = { id: 12, accountRevision: 3, enabled: true, accountId: "acct" };
const aggregate = {
  total: 120, disabled: 2, error: 3, install_error: 1, unknown: 4, no_license: 0,
  outdated: 10, protected: 100, offline: 5, unknown_contact: 6, unlinked: 7, critical: 8, no_auto: 9,
};
const mapRow = (id: number) => ({
  id, hostName: `host-${id}`, ipAddress: null, deviceType: 1, operatingSystem: "Linux", groupPath: "Production",
  agentVersion: null, bucket: "protected", accumulatedProtectionStatus: 1, offline: false,
  lastConnectionAt: new Date(), lastSyncedAt: new Date(), rebootRequested: false, deviceId: null,
  assetName: null, isCritical: false, noAuto: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { userId: 1, role: "admin" } });
  mocks.access.mockResolvedValue(true);
  mocks.adminAccess.mockResolvedValue(true);
  mocks.selectQueue = [[{ name: "Site" }], [connection], [binding]];
  mocks.execute.mockReset()
    .mockResolvedValueOnce({ rows: [aggregate] })
    .mockResolvedValueOnce({ rows: Array.from({ length: 301 }, (_, index) => mapRow(index + 1)) })
    .mockResolvedValueOnce({ rows: [{ id: 1, hostName: "host-1", deviceType: 1, isCritical: false, bucket: "disabled", offline: false, lastConnectionAt: new Date() }] })
    .mockResolvedValueOnce({ rows: [{ kind: "group", value: "Production" }, { kind: "os", value: "Linux" }] });
});

describe("aggregated fleet overview", () => {
  it("denies missing membership before any query", async () => {
    mocks.access.mockResolvedValue(false);
    expect(await getEpdrFleetOverview()).toEqual({ message: "Unauthorized." });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns an empty summary without a usable binding", async () => {
    mocks.selectQueue = [[{ name: "Site" }], [connection], []];
    expect(await getEpdrFleetOverview()).toMatchObject({
      endpoints: [], posture: { total: 0, protectedPct: null },
      summary: { total: 0, groups: [], operatingSystems: [], mapTruncated: false },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("computes counts, options and a bounded map sample on the server", async () => {
    const result = await getEpdrFleetOverview();
    if ("message" in result) throw new Error(result.message);
    expect(result.summary).toMatchObject({
      total: 120, offline: 5, unknownContact: 6, unlinked: 7, critical: 8, noAuto: 9,
      groups: ["Production"], operatingSystems: ["Linux"], mapLimit: 300, mapTruncated: true,
    });
    expect(result.summary.counts).toMatchObject({ disabled: 2, error: 3, protected: 100, outdated: 10 });
    expect(result.endpoints).toHaveLength(300);
    expect(result.posture).toMatchObject({ total: 120, offline: 5, protectedPct: 91.6 });
    expect(result.posture.attention).toHaveLength(1);
    expect(mocks.execute).toHaveBeenCalledTimes(4);
    const dialect = new PgDialect();
    const compiled = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    for (const query of compiled) {
      expect(query.sql).toContain('"epdr_endpoints"."connection_id"');
      expect(query.sql).toContain('"epdr_endpoints"."account_revision"');
    }
    expect(compiled[0].sql).toContain("count(*) FILTER");
    expect(compiled[0].params).toContain(12);
    expect(compiled[1].params).toContain(301);
    expect(compiled[2].sql).toContain("array_position");
  });
});
