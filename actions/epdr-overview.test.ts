import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { bucketForEndpoint } from "@/lib/epdr/posture";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), access: vi.fn(), context: vi.fn(), binding: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAction: mocks.guard }));
vi.mock("@/lib/site-access", () => ({ requireSiteAccess: mocks.access }));
vi.mock("./epdr-endpoints", () => ({ loadSecurityContext: mocks.context }));
vi.mock("@/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: mocks.binding }) }) }), execute: mocks.execute,
} }));
import { getEpdrOverview } from "./epdr-overview";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 7, session: { role: "admin" } });
  mocks.access.mockResolvedValue(true);
  mocks.context.mockResolvedValue({ isAdmin: true, connection: "live" });
  mocks.binding.mockResolvedValue([{ id: 12, enabled: true, accountId: "account", accountRevision: 4,
    inventory: new Date(), detections: null, provider: new Date(0), inventoryMinutes: 15, detectionMinutes: 5 }]);
  mocks.execute.mockResolvedValue({ rows: [{ total: 1200, protected: 1000, unknown: 20, threats: 44, highScore: 5 }] });
});
describe("operations overview", () => {
  it("denies unauthorized reads before querying", async () => {
    mocks.access.mockResolvedValue(false);
    expect(await getEpdrOverview()).toEqual({ message: "Unauthorized." });
    expect(mocks.binding).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([
    { binding: [] },
    { binding: [{ enabled: false, accountId: "account" }] },
    { binding: [{ enabled: true, accountId: " " }] },
  ])("does not query without a usable binding $binding", async ({ binding }) => {
    mocks.binding.mockResolvedValue(binding);
    expect(await getEpdrOverview()).toMatchObject({ counts: null, available: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("uses full aggregate counts and independently classifies sources", async () => {
    const result = await getEpdrOverview();
    expect(result).toMatchObject({ available: true, counts: { total: 1200 }, sources: [
      { source: "inventory", state: "unverified" }, { source: "detections", state: "unknown" }, { source: "provider", state: "stale" },
    ] });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql.match(/account_revision =/g)).toHaveLength(3);
    expect(query.sql.match(/connection_id =/g)).toHaveLength(3);
    expect(query.sql.match(/site_id =/g)).toHaveLength(3);
    expect(query.sql).toContain("removed_at IS NULL");
    expect(query.sql).toContain("ignored_reason IS NULL");
    expect(query.sql).toContain("count(*) FILTER");
    expect(query.sql).not.toMatch(/LIMIT|OFFSET/);
    expect(query.params).toContain(7);
    expect(query.params).toContain(12);
    expect(query.params).toContain(4);
  });
  it("matches existing fleet protected semantics for nullable update enums", async () => {
    await getEpdrOverview();
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain("protection = 1 AND engine IS DISTINCT FROM 1 AND catalog IS DISTINCT FROM 1");
    for (const engine of [null, 0, 1, 2]) {
      for (const catalog of [null, 0, 1, 2]) {
        const sqlProtected = engine !== 1 && catalog !== 1;
        expect(bucketForEndpoint({ accumulatedProtectionStatus: 1,
          protectionEngineUpdateStatus: engine, knowledgeCatalogUpdateStatus: catalog }) === "protected").toBe(sqlProtected);
      }
    }
  });
  it("never converts a failed aggregate into safe-looking zeros", async () => {
    mocks.execute.mockRejectedValue(new Error("missing migration"));
    expect(await getEpdrOverview()).toMatchObject({ available: false, counts: null });
  });
  it("does not claim source-specific health when the shared error is cleared", async () => {
    mocks.binding.mockResolvedValue([{ id: 12, enabled: true, accountId: "account", accountRevision: 4,
      inventory: new Date(), detections: new Date(), provider: new Date(), error: null, providerError: null }]);
    expect(await getEpdrOverview()).toMatchObject({ sources: [
      { source: "inventory", state: "unverified" }, { source: "detections", state: "unverified" }, { source: "provider", state: "current" },
    ] });
  });
  it("marks shared sync errors as partial without inventing which ingestion failed", async () => {
    mocks.binding.mockResolvedValue([{ id: 12, enabled: true, accountId: "account", accountRevision: 4,
      inventory: new Date(), detections: new Date(), provider: new Date(), error: "redacted error", providerError: null }]);
    expect(await getEpdrOverview()).toMatchObject({ sources: [
      { source: "inventory", state: "partial" }, { source: "detections", state: "partial" }, { source: "provider", state: "current" },
    ] });
  });
});
