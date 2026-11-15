import { readFileSync } from "node:fs";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), execute: vi.fn(), transaction: vi.fn(), txExecute: vi.fn(),
  actor: vi.fn(), preview: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));
vi.mock("./epdr-playbooks", () => ({ previewEpdrPlaybooks: mocks.preview }));

import { getEpdrPlaybookHistory, recordEpdrPlaybookSimulation, saveEpdrPlaybookVersion } from "./epdr-playbook-history";

const tx = { execute: mocks.txExecute };
const dialect = new PgDialect();
const compile = (query: SQL) => dialect.sqlToQuery(query);
const config = () => ({
  templateId: "malware-virus", name: "Review malware", mode: "simulate",
  filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 },
});
const definition = () => ({ schemaVersion: 1, template: {
  id: "malware-virus", categories: ["malware", "virus"], sources: ["threatsync", "event_export"],
  previewAvailable: true, minScore: null, localSeverity: "High", steps: ["review", "incident", "scan"],
} });
const blocked = { status: "blocked", reason: "partial", providerLocked: true, steps: [] };
const preview = () => ({
  siteId: 17, siteName: "Site A", sampledAt: "2026-01-02T00:00:00.000Z",
  since: "2026-01-01T00:00:00.000Z", limit: 100, truncated: true,
  healthAvailable: false, detectionCompleteness: "unavailable",
  rows: [{ id: 31, source: "threatsync", category: "malware", score: null,
    evaluations: [{ templateId: "malware-virus", result: blocked }],
    rawPayload: "must never be copied" }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
  mocks.transaction.mockImplementation(async (callback: (connection: typeof tx) => unknown) => callback(tx));
  mocks.txExecute.mockResolvedValue({ rows: [] });
  mocks.execute.mockResolvedValue({ rows: [{ configuration: config(), definition: definition() }] });
  mocks.preview.mockResolvedValue(preview());
});

function expectNoStorage() {
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.txExecute).not.toHaveBeenCalled();
  expect(mocks.actor).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
}

describe("playbook history authorization and configuration", () => {
  it.each(["unauthenticated", "not an admin", "no active site"])("denies %s before storage or preview", async (message) => {
    mocks.guard.mockResolvedValue({ ok: false, message });
    expect(await saveEpdrPlaybookVersion(config())).toEqual({ message });
    expect(await recordEpdrPlaybookSimulation(4)).toEqual({ message });
    expect(await getEpdrPlaybookHistory()).toEqual({ message });
    expectNoStorage();
  });

  it.each([
    ["null", null], ["missing fields", {}],
    ["unknown template", { ...config(), templateId: "provider-isolate" }],
    ["dispatch mode", { ...config(), mode: "execute" }],
    ["blank name", { ...config(), name: "  " }],
    ["long name", { ...config(), name: "x".repeat(121) }],
    ["client site", { ...config(), siteId: 999 }],
    ["provider task", { ...config(), providerTask: "isolate" }],
    ["action URL", { ...config(), actionUrl: "https://provider.invalid/run" }],
    ["nested extra", { ...config(), filters: { ...config().filters, siteId: 999 } }],
    ["unknown source", { ...config(), filters: { ...config().filters, source: "any-provider" } }],
    ["unknown category", { ...config(), filters: { ...config().filters, category: "unknown" } }],
    ["unknown score", { ...config(), filters: { ...config().filters, score: "high" } }],
    ["inverted scores", { ...config(), filters: { ...config().filters, minScore: 9, maxScore: 2 } }],
    ["fractional score", { ...config(), filters: { ...config().filters, minScore: 1.5 } }],
    ["score below range", { ...config(), filters: { ...config().filters, minScore: 0 } }],
    ["score above range", { ...config(), filters: { ...config().filters, maxScore: 11 } }],
  ])("rejects %s without SQL", async (_label, input) => {
    expect(await saveEpdrPlaybookVersion(input)).toEqual({ message: "Invalid simulation configuration." });
    expectNoStorage();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid version %s without SQL", async (id) => {
    expect(await recordEpdrPlaybookSimulation(id)).toEqual({ message: "Invalid version." });
    expectNoStorage();
  });
});

describe("append-only version allocation", () => {
  it("locks the active site before actor revalidation and allocates serials inside the transaction", async () => {
    mocks.txExecute.mockResolvedValueOnce({ rows: [{ id: 17 }] }).mockResolvedValueOnce({ rows: [{ id: 42, version: 3 }] });
    const input = { ...config(), name: "  O'Hare; DROP TABLE sites; --  " };
    expect(await saveEpdrPlaybookVersion(input)).toEqual({ id: 42, version: 3 });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.actor).toHaveBeenCalledWith(tx, 17, 9);
    const lock = compile(mocks.txExecute.mock.calls[0][0]);
    expect(lock.sql).toMatch(/SELECT id FROM sites WHERE id = \$1 FOR UPDATE/i);
    expect(lock.params).toEqual([17]);
    expect(mocks.txExecute.mock.invocationCallOrder[0]).toBeLessThan(mocks.actor.mock.invocationCallOrder[0]);
    expect(mocks.actor.mock.invocationCallOrder[0]).toBeLessThan(mocks.txExecute.mock.invocationCallOrder[1]);
    const insert = compile(mocks.txExecute.mock.calls[1][0]);
    expect(insert.sql).toMatch(/INSERT INTO epdr_playbook_versions/);
    expect(insert.sql).toMatch(/coalesce\(max\(version\), 0\) \+ 1/);
    expect(insert.sql).toMatch(/WHERE site_id = \$\d+ AND template_id = \$\d+/);
    expect(insert.sql).toContain("'simulate'");
    expect(insert.sql).not.toContain("DROP TABLE");
    expect(insert.params).toEqual([17, "malware-virus", input.name.trim(), JSON.stringify({ ...input, name: input.name.trim() }), JSON.stringify(definition()), 9, 17, "malware-virus"]);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("does not insert if the actor lost site/admin access while waiting for the lock", async () => {
    mocks.actor.mockRejectedValue(new Error("actor_revoked private"));
    expect(await saveEpdrPlaybookVersion(config())).toEqual({ message: "Playbook could not be saved. Check access and required migrations." });
    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
    expect(compile(mocks.txExecute.mock.calls[0][0]).sql).toContain("FOR UPDATE");
  });

  it("returns a safe error rather than undefined when INSERT RETURNING is empty", async () => {
    expect(await saveEpdrPlaybookVersion(config())).toEqual({ message: "Playbook could not be saved. Check access and required migrations." });
  });

  it("hides migration/storage failures", async () => {
    mocks.transaction.mockRejectedValue(new Error("password secret missing relation"));
    expect(await saveEpdrPlaybookVersion(config())).toEqual({ message: "Playbook could not be saved. Check access and required migrations." });
  });
});

describe("explicit simulation recording", () => {
  it("records only site-bound immutable evidence, preserving unavailable completeness and blocked outcomes", async () => {
    mocks.txExecute.mockResolvedValue({ rows: [{ id: 88 }] });
    expect(await recordEpdrPlaybookSimulation(42)).toEqual({ id: 88 });
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    const read = compile(mocks.execute.mock.calls[0][0]);
    expect(read.sql).toMatch(/WHERE id = \$1 AND site_id = \$2 AND mode = 'simulate'/);
    expect(read.params).toEqual([42, 17]);
    expect(mocks.actor).toHaveBeenCalledWith(tx, 17, 9);
    expect(mocks.actor.mock.invocationCallOrder[0]).toBeLessThan(mocks.txExecute.mock.invocationCallOrder[0]);
    const insert = compile(mocks.txExecute.mock.calls[0][0]);
    expect(insert.sql).toMatch(/INSERT INTO epdr_playbook_runs/);
    expect(insert.sql).toMatch(/FROM epdr_playbook_versions WHERE id = \$\d+ AND site_id = \$\d+ AND mode = 'simulate'/);
    expect(insert.sql).toContain("'simulation_recorded'");
    expect(insert.params[0]).toBe(9);
    expect(insert.params.slice(2)).toEqual([42, 17]);
    expect(JSON.parse(insert.params[1] as string)).toEqual({
      schemaVersion: 1, mode: "simulate", providerLocked: true, sampledAt: preview().sampledAt, since: preview().since,
      steps: [{ step: "review", ordinal: 0, state: "inert" }, { step: "incident", ordinal: 1, state: "inert" }, { step: "scan", ordinal: 2, state: "inert" }],
      limit: 100, truncated: true, detectionCompleteness: "unavailable",
      rows: [{ id: 31, source: "threatsync", category: "malware", score: null, result: blocked }],
    });
    for (const [query] of [...mocks.execute.mock.calls, ...mocks.txExecute.mock.calls]) {
      expect(compile(query).sql).not.toMatch(/\b(?:incidents|notifications|work_items|provider_tasks)\b/i);
    }
  });

  it("applies the saved filters and uses only the saved template evaluation", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ configuration: { ...config(), filters: { ...config().filters, source: "event_export", score: "range", minScore: 4, maxScore: 6 } }, definition: definition() }] });
    mocks.preview.mockResolvedValue({ ...preview(), rows: [
      ...preview().rows,
      { id: 32, source: "event_export", category: "virus", score: 5, evaluations: [{ templateId: "ioa", result: { status: "simulated" } }, { templateId: "malware-virus", result: blocked }] },
      { id: 33, source: "event_export", category: "virus", score: 9, evaluations: [] },
    ] });
    mocks.txExecute.mockResolvedValue({ rows: [{ id: 88 }] });
    await recordEpdrPlaybookSimulation(42);
    const evidence = JSON.parse(compile(mocks.txExecute.mock.calls[0][0]).params[1] as string);
    expect(evidence.rows).toEqual([{ id: 32, source: "event_export", category: "virus", score: 5, result: blocked }]);
  });

  it.each([undefined, { ...config(), mode: "execute" }, { ...config(), siteId: 999 }])("rejects missing, cross-site or invalid stored configurations before preview", async (configuration) => {
    mocks.execute.mockResolvedValue({ rows: configuration ? [{ configuration }] : [] });
    expect(await recordEpdrPlaybookSimulation(999)).toEqual({ message: "Simulation version unavailable." });
    expect(compile(mocks.execute.mock.calls[0][0]).params).toEqual([999, 17]);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([undefined, { ...definition(), schemaVersion: 2 }, { ...definition(), template: { ...definition().template, steps: ["isolate"] } }])("rejects missing or changed immutable template definitions before preview", async (savedDefinition) => {
    mocks.execute.mockResolvedValue({ rows: [{ configuration: config(), definition: savedDefinition }] });
    expect(await recordEpdrPlaybookSimulation(42)).toEqual({ message: "Template definition changed. Save a new simulation version." });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([{ message: "private failure" }, { ...preview(), siteId: 999 }])("rejects unavailable or cross-site preview evidence", async (value) => {
    mocks.preview.mockResolvedValue(value);
    expect(await recordEpdrPlaybookSimulation(42)).toEqual({ message: "Site evidence unavailable." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("revalidates the actor after preview and refuses to insert after access changes", async () => {
    mocks.actor.mockRejectedValue(new Error("actor revoked"));
    expect(await recordEpdrPlaybookSimulation(42)).toEqual({ message: "Simulation could not be recorded. No provider action was requested." });
    expect(mocks.preview.mock.invocationCallOrder[0]).toBeLessThan(mocks.actor.mock.invocationCallOrder[0]);
    expect(mocks.txExecute).not.toHaveBeenCalled();
  });

  it("rejects a version which disappears or no longer belongs to the active site before recording", async () => {
    expect(await recordEpdrPlaybookSimulation(42)).toEqual({ message: "Simulation could not be recorded. No provider action was requested." });
    expect(compile(mocks.txExecute.mock.calls[0][0]).params.slice(2)).toEqual([42, 17]);
  });

  it.each(["read", "preview", "insert"])("sanitizes %s failures without fabricating a run", async (stage) => {
    if (stage === "read") mocks.execute.mockRejectedValue(new Error("private SQL"));
    if (stage === "preview") mocks.preview.mockRejectedValue(new Error("private provider"));
    if (stage === "insert") mocks.txExecute.mockRejectedValue(new Error("private SQL"));
    expect(await recordEpdrPlaybookSimulation(42)).toEqual({ message: "Simulation could not be recorded. No provider action was requested." });
  });

  it("imports no provider, incident, notification or dispatch implementation", () => {
    const source = readFileSync(new URL("./epdr-playbook-history.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/(?:import[\s\S]*?from\s*|import\s*\()(["'])(.*?)\1/g)].map((match) => match[2]);
    expect(imports.sort()).toEqual([
      "node:util", "drizzle-orm", "zod", "@/db", "@/lib/action-auth", "@/lib/epdr/read-sync-queue", "@/lib/epdr/playbook-config", "@/lib/epdr/playbooks", "./epdr-playbooks",
    ].sort());
    expect(source).not.toMatch(/\b(?:fetch|createIncident|sendNotification|enqueueReadSync|dispatchProviderTask)\s*\(/);
  });
});

describe("bounded tenant history", () => {
  it("revalidates the actor and reads bounded, site-scoped versions and runs", async () => {
    const created = new Date("2026-01-02T00:00:00Z");
    const evidence = { mode: "simulate", providerLocked: true, rows: [] };
    mocks.txExecute.mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, template_id: "malware-virus", name: "Review", version: 3, created_at: created }] })
      .mockResolvedValueOnce({ rows: [{ id: 88, version_id: 42, status: "simulation_recorded", created_at: created, evidence }] });
    expect(await getEpdrPlaybookHistory()).toEqual({
      limit: 50, versionsPage: 1, versionsPages: 1, versionsTotal: 1, runsPage: 1, runsPages: 1, runsTotal: 1,
      versions: [{ id: 42, templateId: "malware-virus", name: "Review", version: 3, createdAt: created.toISOString() }],
      runs: [{ id: 88, versionId: 42, status: "simulation_recorded", createdAt: created.toISOString(), evidence }],
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.actor).toHaveBeenCalledWith(tx, 17, 9);
    expect(mocks.actor.mock.invocationCallOrder[0]).toBeLessThan(mocks.txExecute.mock.invocationCallOrder[0]);
    expect(mocks.txExecute).toHaveBeenCalledTimes(4);
    const compiledQueries = mocks.txExecute.mock.calls.map(([query]) => compile(query));
    const pageQueries = compiledQueries.filter((query) => query.sql.includes("ORDER BY id DESC"));
    expect(pageQueries).toHaveLength(2);
    for (const query of pageQueries) {
      expect(query.sql).toMatch(/WHERE site_id = \$1 ORDER BY id DESC LIMIT \$2/);
      expect(query.sql).toContain("OFFSET");
      expect(query.params).toEqual([17, 50, 0]);
    }
    expect(compiledQueries.filter((query) => query.sql.includes("count(*)")).map((query) => query.params))
      .toEqual([[17], [17]]);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("pages versions and runs independently and clamps out-of-range pages", async () => {
    mocks.txExecute.mockResolvedValueOnce({ rows: [{ total: 130 }] })
      .mockResolvedValueOnce({ rows: [{ total: 75 }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await getEpdrPlaybookHistory({ versionsPage: 3, runsPage: 2 })).toMatchObject({ versionsPage: 3, versionsPages: 3, runsPage: 2, runsPages: 2 });
    const pageQueries = mocks.txExecute.mock.calls.map(([query]) => compile(query)).filter((query) => query.sql.includes("OFFSET"));
    expect(pageQueries[0].params).toEqual([17, 50, 100]);
    expect(pageQueries[1].params).toEqual([17, 50, 50]);
    mocks.txExecute.mockReset().mockResolvedValueOnce({ rows: [{ total: 10 }] })
      .mockResolvedValueOnce({ rows: [{ total: 10 }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await getEpdrPlaybookHistory({ versionsPage: 99, runsPage: 99 })).toMatchObject({ versionsPage: 1, versionsPages: 1, runsPage: 1, runsPages: 1 });
  });

  it.each([null, { versionsPage: 0 }, { runsPage: 1.5 }, { versionsPage: 10001 }, { runsPage: "2" }, { siteId: 9 }, { limit: 500 }])(
    "rejects invalid history page input %j before database access", async (value) => {
      expect(await getEpdrPlaybookHistory(value)).toEqual({ message: "Invalid history page." });
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

  it("returns empty bounded history without fabricating evidence", async () => {
    expect(await getEpdrPlaybookHistory()).toEqual({
      limit: 50, versionsPage: 1, versionsPages: 1, versionsTotal: 0, runsPage: 1, runsPages: 1, runsTotal: 0,
      versions: [], runs: [],
    });
  });

  it("never reads history for a revoked actor", async () => {
    mocks.actor.mockRejectedValue(new Error("private revoked"));
    expect(await getEpdrPlaybookHistory()).toEqual({ message: "History unavailable. Check access and required migrations." });
    expect(mocks.txExecute).not.toHaveBeenCalled();
  });

  it.each([1, 2])("hides SQL failure in history query %s and does not return partial history", async (query) => {
    if (query === 2) mocks.txExecute.mockResolvedValueOnce({ rows: [] });
    mocks.txExecute.mockRejectedValueOnce(new Error("private missing relation"));
    expect(await getEpdrPlaybookHistory()).toEqual({ message: "History unavailable. Check access and required migrations." });
  });
});
