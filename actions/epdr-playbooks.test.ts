import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), access: vi.fn(), select: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAction: mocks.guard }));
vi.mock("@/lib/site-access", () => ({ requireSiteAccess: mocks.access }));
vi.mock("@/db", () => ({ db: { select: mocks.select, execute: mocks.execute } }));
import { previewEpdrPlaybooks } from "./epdr-playbooks";
function query(value: unknown[]) {
  const q = { from: vi.fn(), where: vi.fn(), innerJoin: vi.fn(), leftJoin: vi.fn(), orderBy: vi.fn(), limit: vi.fn().mockResolvedValue(value) };
  q.from.mockReturnValue(q); q.where.mockReturnValue(q); q.innerJoin.mockReturnValue(q); q.leftJoin.mockReturnValue(q); q.orderBy.mockReturnValue(q);
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 42, session: { role: "staff" } });
  mocks.access.mockResolvedValue(true);
  mocks.execute.mockResolvedValue({ rows: [] });
});
describe("stored site playbook preview", () => {
  it("rejects absent active site before querying", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "No active site selected." });
    expect(await previewEpdrPlaybooks()).toEqual({ message: "No active site selected." });
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("requires membership even with active site", async () => {
    mocks.access.mockResolvedValue(false);
    expect(await previewEpdrPlaybooks()).toEqual({ message: "Unauthorized." });
    expect(mocks.access).toHaveBeenCalledWith(42); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("returns capped minimal DTOs, truncation and inert results only", async () => {
    const now = new Date();
    const row = { id: 1, source: "threatsync", category: "ioa", score: 8, detectedAt: now, endpointId: 2, providerId: "local-test", platformId: 1, removedAt: null, endpointSyncedAt: now, detectionSyncedAt: now, syncError: null, enabled: true };
    const site = query([{ name: "Site A" }]); const detections = query(Array.from({ length: 101 }, (_, id) => ({ ...row, id })));
    mocks.select.mockReturnValueOnce(site).mockReturnValueOnce(detections);
    const result = await previewEpdrPlaybooks();
    expect(result).toMatchObject({ siteId: 42, siteName: "Site A", limit: 100, truncated: true, healthAvailable: false, detectionCompleteness: "unavailable" });
    if ("message" in result) throw new Error(result.message);
    expect(result.rows).toHaveLength(100);
    expect(result.rows[0].evaluations[4].result).toMatchObject({ status: "blocked", reason: "partial", providerLocked: true, steps: [] });
    expect(Object.keys(result.rows[0])).toEqual(["id", "source", "category", "score", "evaluations"]);
    expect(detections.limit).toHaveBeenCalledWith(101);
    expect(detections.leftJoin).toHaveBeenCalledTimes(1);
    expect(detections.where).toHaveBeenCalledOnce();
    const dialect = new PgDialect();
    expect(detections.innerJoin).toHaveBeenCalledOnce();
    const binding = dialect.sqlToQuery(detections.innerJoin.mock.calls[0][1]);
    expect(binding.sql).toContain('"watchguard_connections"."account_revision" = "epdr_detections"."account_revision"');
    expect(binding.sql).toContain('"watchguard_connections"."enabled" =');
    expect(dialect.sqlToQuery(detections.leftJoin.mock.calls[0][1]).sql)
      .toContain('"epdr_endpoints"."account_revision" = "epdr_detections"."account_revision"');
    const scope = dialect.sqlToQuery(detections.where.mock.calls[0][0]);
    expect(scope.sql).toContain('"epdr_detections"."site_id" =');
    expect(scope.sql).toContain('"epdr_detections"."detected_at" >=');
    expect(scope.sql).toContain('"epdr_detections"."detected_at" <=');
    expect(scope.params[0]).toBe(42);
    for (const join of detections.leftJoin.mock.calls) {
      const joinScope = dialect.sqlToQuery(join[1]);
      expect(joinScope.sql).toContain('"site_id" =');
      expect(joinScope.params).toContain(42);
    }
    const selected = Object.keys(mocks.select.mock.calls[1][0]);
    for (const field of ["raw", "platformId", "detectionSyncedAt", "syncError", "endpointSyncedAt"]) expect(selected).not.toContain(field);
    expect(result.rows[0].evaluations[3].result.status).toBe("no_match");
  });
  it("uses current source evidence but invalidates it after a settings change", async () => {
    const now = new Date();
    const settingsAt = new Date(now.getTime() - 60_000);
    const sample = { id: 1, source: "threatsync", category: "ioa", score: 8, detectedAt: now,
      endpointId: 2, providerId: "test", removedAt: null, connectionId: 9, accountRevision: 3, credentialRevision: 4 };
    const attempt = { connectionId: 9, accountRevision: 3, credentialRevision: 4, source: "threatsync",
      status: "completed", window: "provider_default", startedAt: now, finishedAt: now,
      eventTypes: [], completedEventTypes: [], enabled: true, settingsUpdatedAt: settingsAt, settingsChangedAt: settingsAt };
    for (const changed of [false, true]) {
      mocks.select.mockReturnValueOnce(query([{ name: "Site A" }])).mockReturnValueOnce(query([sample]));
      mocks.execute.mockResolvedValueOnce({ rows: [{ ...attempt, settingsChangedAt: changed ? now : settingsAt }] });
      const result = await previewEpdrPlaybooks();
      if ("message" in result) throw new Error(result.message);
      expect(result.detectionCompleteness).toBe("source_specific");
      expect(result.rows[0].evaluations[4].result).toMatchObject(changed
        ? { status: "blocked", reason: "partial" } : { status: "simulated", reason: "eligible" });
    }
    const scope = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(scope.sql).toContain("c.credential_revision = e.credential_revision");
    expect(scope.sql).toContain("ORDER BY e.source, e.started_at DESC, e.id DESC");
    expect(scope.sql).not.toContain("e.status = 'completed'");
  });
  it.each([null, 1, 888])("does not guess platform capability or infer source completeness from healthy shared fields (%s)", async (platformId) => {
    const now = new Date();
    mocks.select.mockReturnValueOnce(query([{ name: "Site A" }])).mockReturnValueOnce(query([{ id: 1, source: "event_export", category: "malware", score: null, detectedAt: now, endpointId: 2, providerId: "test", removedAt: null, platformId, enabled: true, endpointSyncedAt: now, detectionSyncedAt: now, syncError: null }]));
    const result = await previewEpdrPlaybooks();
    if ("message" in result) throw new Error(result.message);
    expect(result.detectionCompleteness).toBe("unavailable");
    expect(result.rows[0].evaluations[3].result).toMatchObject({ status: "blocked", reason: "partial", steps: [] });
  });
  it("does not classify unrelated events as blocked matches", async () => {
    mocks.select.mockReturnValueOnce(query([{ name: "Site A" }])).mockReturnValueOnce(query([{ id: 1, source: "event_export", category: "ioa", score: null, detectedAt: new Date(), endpointId: 2, providerId: "test", platformId: 1, removedAt: null, enabled: true, endpointSyncedAt: new Date(), detectionSyncedAt: null, syncError: null }]));
    const result = await previewEpdrPlaybooks();
    if ("message" in result) throw new Error(result.message);
    expect(result.rows[0].evaluations[4].result).toMatchObject({ status: "no_match", reason: "criteria" });
  });
});
