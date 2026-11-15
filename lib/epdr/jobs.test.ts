import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), all: vi.fn(), where: vi.fn(), client: vi.fn(), build: vi.fn(), set: vi.fn(), resolve: vi.fn(), sync: vi.fn(), execute: vi.fn(), transaction: vi.fn(), insert: vi.fn() }));
function selectChain() {
  const chain = {
    from: () => chain, innerJoin: () => chain, orderBy: () => chain,
    where: (condition: unknown) => { mocks.where(condition); return chain; },
    limit: mocks.select,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => mocks.all().then(resolve, reject),
  };
  return chain;
}
vi.mock("@/db", () => ({ db: {
  transaction: mocks.transaction,
  execute: mocks.execute,
  select: selectChain,
  update: () => ({ set: (values: unknown) => { mocks.set(values); return { where: async () => undefined }; } }),
} }));
vi.mock("@/lib/database-url", () => ({ buildDatabaseUrl: () => { throw new Error("unexpected DB access"); } }));
vi.mock("@/lib/watchguard/connection", () => ({ resolveWatchGuardConnection: mocks.resolve }));
vi.mock("@/lib/watchguard/client", () => ({ createWatchGuardClient: mocks.client }));
vi.mock("./detect-ingest", () => ({ buildThreatSyncDetections: mocks.build, buildSecurityEventDetections: vi.fn(), threatKeyFor: vi.fn() }));
vi.mock("./sync", () => ({ syncEndpoints: mocks.sync }));
import { EPDR_JOBS, runEndpointsJob, runPendingReadSyncRequests } from "./jobs";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { epdrDetections, epdrEndpoints } from "@/db/schema";

const run = (id = 1) => EPDR_JOBS.find((job) => job.name === "endpoints")!.run(id);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockResolvedValue([{ id: 1, siteId: 1, enabled: true, accountRevision: 1, credentialRevision: 1 }]);
  mocks.resolve.mockResolvedValue({ ok: true, credentials: {}, credentialRevision: 1, accountRevision: 1 });
  mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute, insert: mocks.insert, select: selectChain }));
  mocks.all.mockResolvedValue([]);
  mocks.client.mockReturnValue({});
  mocks.execute.mockResolvedValue({ rows: [] });
});

describe("endpoint job outcomes (mock DB only)", () => {
  it("persists credential-resolution failure and fails the worker job", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, reason: "not_configured" });
    await expect(run()).rejects.toThrow("endpoint_sync_failed");
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("publishes safe resolution errors only while the binding is current", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, reason: "not_configured" });
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [] });
    await expect(run()).rejects.toThrow("endpoint_sync_failed");
    const queries = mocks.execute.mock.calls.map(([q]) => new PgDialect().sqlToQuery(q));
    expect(queries[0].sql).toContain("credential_revision");
    expect(queries[0].sql).toContain("FOR UPDATE");
    expect(queries[1].sql).toContain("last_sync_error = 'endpoint_connection_unavailable'");
    expect(queries[1].sql).not.toContain("last_endpoint_sync_at");
  });

  it.each(["partial", "failed"])("propagates %s sync without advancing success time", async (status) => {
    mocks.sync.mockResolvedValue({ status });
    await expect(run()).rejects.toThrow("endpoint_sync_failed");
    for (const [values] of mocks.set.mock.calls) expect(values).not.toHaveProperty("lastEndpointSyncAt");
  });

  it.each(["partial", "failed"])("persists %s manual sync as failed, never succeeded", async (status) => {
    mocks.execute.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, connection_id: 1, lease_token: "token" }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.sync.mockResolvedValue({ status });
    await runPendingReadSyncRequests();
    const final = new PgDialect().sqlToQuery(mocks.execute.mock.calls[2][0]);
    expect(final.params).toContain(status === "partial" ? "partial" : "failed");
    expect(final.params).not.toContain("succeeded");
  });
  it("reports only completed sync as success", async () => {
    mocks.sync.mockResolvedValue({ status: "ok" });
    await expect(run()).resolves.toBeUndefined();
  });
  it("does not mark a scheduled lock skip as success", async () => {
    mocks.sync.mockResolvedValue({ status: "skipped_locked" });
    await expect(run()).rejects.toThrow("endpoint_sync_locked");
  });
  it.each(["revision", "lease"])("refuses publication when %s guard fails", async (guard) => {
    mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute, insert: mocks.insert }));
    mocks.execute.mockResolvedValueOnce({ rows: guard === "revision" ? [] : [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.sync.mockImplementationOnce(async (deps) => {
      await deps.recordSyncRun("endpoints", "ok", {});
      return { status: "ok" };
    });
    await expect(runEndpointsJob(1, { requestId: 42, leaseToken: "token" })).rejects.toThrow("endpoint_sync_failed");
    expect(mocks.insert).not.toHaveBeenCalled();
    const dialect = new PgDialect();
    const first = dialect.sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(first.sql).toContain("account_revision");
    expect(first.sql).toContain("credential_revision");
    expect(first.sql).toContain("FOR UPDATE");
    if (guard === "lease") {
      const second = dialect.sqlToQuery(mocks.execute.mock.calls[1][0]);
      expect(second.sql).toContain("lease_until > clock_timestamp()");
      expect(second.params).toContain("token");
    }
  });
  it.each(["inactive", "revoked"])("fences publication after actor %s", async (kind) => {
    mocks.transaction.mockImplementation((fn) => fn({ execute: mocks.execute, insert: mocks.insert }));
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ requested_by: 9 }] })
      .mockResolvedValueOnce({ rows: kind === "inactive" ? [] : [{ role: "staff" }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.sync.mockImplementationOnce(async (deps) => {
      await deps.recordSyncRun("endpoints", "ok", {});
      return { status: "ok" };
    });
    await expect(runEndpointsJob(1, { requestId: 42, leaseToken: "token" })).rejects.toThrow("endpoint_sync_failed");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects a binding changed during credential resolution", async () => {
    mocks.resolve.mockResolvedValue({ ok: true, credentials: {}, credentialRevision: 1, accountRevision: 2 });
    await expect(run()).rejects.toThrow("endpoint_sync_failed");
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});


describe("detection publication revisions (mock DB only)", () => {
  it("keeps revision-aware deduplication aligned between schema and registered migration", () => {
    const index = getTableConfig(epdrDetections).indexes.find((entry) => entry.config.name === "epdr_detections_connection_source_key_unique")!;
    expect(index.config.unique).toBe(true);
    expect(index.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["connection_id", "account_revision", "source", "source_key"]);
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0079_epdr_detection_revision_identity.sql"), "utf8");
    expect(migration).toContain("DROP CONSTRAINT epdr_detections_connection_id_source_source_key_key");
    expect(migration).toContain("ON epdr_endpoints(connection_id, account_revision, wg_device_id)");
    const endpointIndex = getTableConfig(epdrEndpoints).indexes.find((entry) => entry.config.name === "epdr_endpoints_connection_device_unique")!;
    expect(endpointIndex.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["connection_id", "account_revision", "wg_device_id"]);
    expect(migration).toContain("ON epdr_detections(connection_id, account_revision, source, source_key)");
    expect(migration).not.toMatch(/DELETE FROM|UPDATE epdr_detections/);
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(journal.entries.filter((entry: { tag: string }) => entry.tag === "0079_epdr_detection_revision_identity")).toHaveLength(1);
  });
  const detect = () => EPDR_JOBS.find((job) => job.name === "detections")!.run(1);
  function ingestion(unmatched = false) {
    mocks.select.mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true, accountRevision: 3, credentialRevision: 4 }])
      .mockResolvedValueOnce([{}]);
    mocks.resolve.mockResolvedValue({ ok: true, credentials: {}, accountRevision: 3, credentialRevision: 4 });
    mocks.client.mockReturnValue({ iterateIncidents: async function* () { yield {}; } });
    mocks.build.mockReturnValue(unmatched
      ? { detections: [], unmatched: [{ source: "threatsync", sourceKey: "same-key", reason: "below_threshold", raw: {} }] }
      : { detections: [{ source: "threatsync", sourceKey: "same-key", endpointProviderId: "device", category: "malware", severity: "High", detectedAt: new Date(), raw: {} }], unmatched: [] });
  }
  it.each(["accountRevision", "credentialRevision"])("rejects changed %s before reading provider data", async (revision) => {
    ingestion();
    mocks.resolve.mockResolvedValue({ ok: true, credentials: {}, accountRevision: 3, credentialRevision: 4, [revision]: 99 });
    await expect(detect()).rejects.toThrow("detection_binding_changed");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each([false, true])("fences publication after rebinding, ignored=%s", async (ignored) => {
    ingestion(ignored);
    await expect(detect()).rejects.toThrow("detection_binding_changed");
    expect(mocks.insert).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain("FOR UPDATE");
    expect(query.sql).toContain("account_revision");
    expect(query.sql).toContain("credential_revision");
    expect(query.params).toEqual([1, 1, 3, 4]);
  });
  it("resolves endpoint in the fenced transaction and current revision before inserting reread evidence", async () => {
    ingestion();
    mocks.execute.mockResolvedValue({ rows: [{ id: 1 }] });
    // The endpoint is unresolved; no Incident is attached. Recovery is empty.
    mocks.select.mockReset().mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true, accountRevision: 3, credentialRevision: 4 }])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const values = vi.fn(() => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: 20 }] }) }));
    mocks.insert.mockReturnValue({ values });
    await detect();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ accountRevision: 3, sourceKey: "same-key", endpointId: null }));
    const endpointPredicate = new PgDialect().sqlToQuery(mocks.where.mock.calls[3][0]);
    expect(endpointPredicate.sql).toContain("account_revision");
    expect(endpointPredicate.params).toContain(3);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it.each(["completed", "partial", "failed"])("persists ThreatSync %s only after iterator settles", async (outcome) => {
    mocks.select.mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true, accountRevision: 1, credentialRevision: 1 }]).mockResolvedValueOnce([{}]);
    mocks.execute.mockResolvedValue({ rows: [{ id: 1 }] });
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    mocks.build.mockReturnValue({ detections: [], unmatched: [] });
    mocks.client.mockReturnValue({ iterateIncidents: async function* () {
      expect(values).not.toHaveBeenCalled();
      if (outcome !== "failed") yield {};
      expect(values).not.toHaveBeenCalled();
      if (outcome !== "completed") throw new Error("mock read failed");
    } });
    await detect();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: "threatsync", status: outcome, accountRevision: 1, credentialRevision: 1, window: "provider_default" }));
  });

  it("registers migration 0080 without manufacturing legacy completeness", () => {
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0080_epdr_detection_read_evidence.sql"), "utf8");
    expect(migration).toContain("CREATE TABLE epdr_detection_read_evidence");
    expect(migration).not.toMatch(/INSERT INTO|UPDATE |'verified'/);
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(journal.entries.filter((entry: { tag: string }) => entry.tag === "0080_epdr_detection_read_evidence")).toHaveLength(1);
  });

  it("records partial EventExport when one required iterator fails after yielding", async () => {
    const eventTypes = [1, 2, 4, 6, 18];
    mocks.select.mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true, accountRevision: 1, credentialRevision: 1 }])
      .mockResolvedValueOnce([{ threatsyncEnabled: false, ingestEnabled: true, eventTypes }]);
    mocks.execute.mockResolvedValue({ rows: [{ id: 1 }] });
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    // Normalization error is also an incomplete read, never completed evidence.
    mocks.client.mockReturnValue({ iterateSecurityEvents: async function* (type: number) {
      if (type === 18) { yield {}; throw new Error("mock paging failure"); }
    } });
    await detect();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: "event_export", status: "partial", completedEventTypes: [1, 2, 4, 6] }));
  });

  it("rejects provenance publication when site settings changed during a read", async () => {
    mocks.select.mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true, accountRevision: 1, credentialRevision: 1 }])
      .mockResolvedValueOnce([{ updatedAt: new Date(100) }]);
    mocks.client.mockReturnValue({ iterateIncidents: async function* () { /* empty successful read */ } });
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: new Date(200) }] });
    await expect(detect()).rejects.toThrow("detection_settings_changed");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not record completeness for disabled sources", async () => {
    mocks.select.mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true }])
      .mockResolvedValueOnce([{ threatsyncEnabled: false, ingestEnabled: false }]);
    await detect();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([[1], [1, 2, 4, 6, 18]])("records EventExport required-set coverage %j", async (...types) => {
    const eventTypes = types as number[];
    mocks.select.mockResolvedValueOnce([{ id: 1, siteId: 1, enabled: true, accountRevision: 1, credentialRevision: 1 }])
      .mockResolvedValueOnce([{ threatsyncEnabled: false, ingestEnabled: true, eventTypes }]);
    mocks.execute.mockResolvedValue({ rows: [{ id: 1 }] });
    const values = vi.fn();
    mocks.insert.mockReturnValue({ values });
    mocks.client.mockReturnValue({ iterateSecurityEvents: async function* () { /* Exhausted empty page is complete. */ } });
    await detect();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: "event_export", status: eventTypes.length === 5 ? "completed" : "partial", completedEventTypes: eventTypes }));
  });
});
