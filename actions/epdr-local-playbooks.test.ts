import { readFileSync } from "node:fs";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYBOOK_TEMPLATES } from "@/lib/epdr/playbooks";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), transaction: vi.fn(), execute: vi.fn(), actor: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/action-auth", () => ({ requireActiveSiteAdminAction: mocks.guard }));
vi.mock("@/lib/epdr/read-sync-queue", () => ({ assertReadSyncActor: mocks.actor }));
import { getEpdrLocalPlaybookRun, getEpdrLocalPlaybookRuns, resumeEpdrLocalPlaybook, startEpdrLocalPlaybook } from "./epdr-local-playbooks";
const dialect = new PgDialect();
const queries = () => mocks.execute.mock.calls.map(([q]) => dialect.sqlToQuery(q as SQL));
const input = { versionId: 42, detectionId: 31, mode: "local", confirmLocalReview: true };
const configuration = { templateId: "malware-virus", name: "Review", mode: "simulate", filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 } };
const definition = { schemaVersion: 1, template: PLAYBOOK_TEMPLATES.find((t) => t.id === "malware-virus") };
const run = { id: 7, requested_by: 9, status: "pending", generation: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, activeSiteId: 17, session: { userId: 9 } });
  mocks.transaction.mockImplementation(async (callback) => callback({ execute: mocks.execute }));
  mocks.execute.mockResolvedValue({ rows: [] });
});
function startRows(existing = false) {
  mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] })
    .mockResolvedValueOnce({ rows: [{ configuration, definition }] })
    .mockResolvedValueOnce({ rows: [{ source: "threatsync", category: "malware", score: 8, detected_at: new Date(), endpoint_id: 5, identity_known: true }] })
    .mockResolvedValueOnce({ rows: existing ? [{ id: 7 }] : [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7 }] });
}
function locked(requestedBy = 9) {
  mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2 }] }).mockResolvedValueOnce({ rows: [{ ...run, requested_by: requestedBy }] });
}
describe("explicit local playbooks", () => {
  it("denies all actions before database access", async () => {
    mocks.guard.mockResolvedValue({ ok: false, message: "Forbidden" });
    expect(await startEpdrLocalPlaybook(input)).toEqual({ message: "Forbidden" });
    expect(await resumeEpdrLocalPlaybook(7)).toEqual({ message: "Forbidden" });
    expect(await getEpdrLocalPlaybookRun(7)).toEqual({ message: "Forbidden" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([{ ...input, siteId: 99 }, { ...input, mode: "simulate" }, { ...input, confirmLocalReview: false }, { ...input, allowIncident: true }])("rejects extra authority or absent confirmation", async (value) => {
    expect(await startEpdrLocalPlaybook(value)).toHaveProperty("message");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("atomically saves immutable evidence and ordered individual steps only", async () => {
    startRows();
    expect(await startEpdrLocalPlaybook(input)).toEqual({ runId: 7, existing: false });
    const compiled = queries();
    const insert = compiled.find((q) => q.sql.includes("INSERT INTO epdr_local_playbook_runs"))!;
    const evidence = JSON.parse(insert.params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
    expect(evidence).toMatchObject({ accountRevision: 3, providerLocked: true, incidentPolicy: "requires_operator", eligibility: { status: "blocked", reason: "partial" },
      responsePolicy: { schemaVersion: 1, scope: "local_review_recommendation", tier: "7-8", status: "blocked", route: null,
        reasons: ["partial", "unknown_flags"], flags: { hold: false, critical: null, noAuto: null },
        providerLocked: true, notificationsEnabled: false, automationDelivered: false, operatorReviewRequired: true } });
    expect(compiled.filter((q) => q.sql.includes("INSERT INTO epdr_local_playbook_steps"))).toHaveLength(4);
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), 17, 9);
    expect(compiled[2].sql).toContain("d.connection_id =");
    expect(compiled[2].sql).toContain("e.account_revision = d.account_revision");
    expect(compiled[2].sql).toContain("d.account_revision = $5");
    expect(compiled[2].params).toEqual([3, 31, 17, 2, 3]);
    expect(compiled[1].sql).toContain("mode = 'simulate'");
  });
  it.each([0, 1])("requires exact settings snapshot equality (offset %s) under a local settings lock", async (offset) => {
    const now = new Date();
    const settingsUpdatedAt = new Date(now.getTime() - 1000);
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3, credential_revision: 4 }] })
      .mockResolvedValueOnce({ rows: [{ configuration, definition }] })
      .mockResolvedValueOnce({ rows: [{ source: "threatsync", category: "malware", score: 8, detected_at: now, identity_known: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ updated_at: settingsUpdatedAt, threatsync_enabled: true, ingest_enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ connectionId: 2, accountRevision: 3, credentialRevision: 4, source: "threatsync",
        settingsUpdatedAt: new Date(settingsUpdatedAt.getTime() + offset), status: "completed", window: "provider_default",
        startedAt: now, finishedAt: now, eventTypes: [], completedEventTypes: [] }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await startEpdrLocalPlaybook(input)).toEqual({ runId: 7, existing: false });
    const compiled = queries();
    expect(compiled[4].sql).toContain("FROM epdr_site_settings");
    expect(compiled[4].sql).toContain("FOR SHARE");
    expect(compiled[5].sql).toContain('settings_updated_at AS "settingsUpdatedAt"');
    expect(compiled[5].sql).toContain("ORDER BY started_at DESC, id DESC LIMIT 1");
    expect(compiled[5].params).toEqual([2, 3, 4, "threatsync"]);
    const insert = compiled.find((q) => q.sql.includes("INSERT INTO epdr_local_playbook_runs"))!;
    const evidence = JSON.parse(insert.params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
    expect(evidence.signal.completeness.status).toBe(offset === 0 ? "verified" : "unknown");
    expect(evidence.signal.syncedAt).toBe(offset === 0 ? now.getTime() : null);
    expect(evidence.responsePolicy).toMatchObject({ status: "blocked", providerLocked: true, automationDelivered: false });
  });
  it.each([
    { hold: false, critical: false, noAuto: false, identityKnown: true },
    { hold: true, critical: false, noAuto: false, identityKnown: true },
    { hold: false, critical: true, noAuto: false, identityKnown: true },
    { hold: false, critical: false, noAuto: true, identityKnown: true },
    { hold: false, critical: false, noAuto: false, identityKnown: false },
  ])("captures authoritative flags and recommends only safe local review %j", async (flags) => {
    const now = new Date();
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3, credential_revision: 4 }] })
      .mockResolvedValueOnce({ rows: [{ configuration, definition }] })
      .mockResolvedValueOnce({ rows: [{ source: "threatsync", category: "malware", score: 8, detected_at: now,
        identity_known: flags.identityKnown, automation_hold: flags.hold, is_critical: flags.critical, no_auto: flags.noAuto }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ updated_at: now, threatsync_enabled: true, ingest_enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ connectionId: 2, accountRevision: 3, credentialRevision: 4, source: "threatsync",
        settingsUpdatedAt: now, status: "completed", window: "provider_default", startedAt: now, finishedAt: now,
        eventTypes: [], completedEventTypes: [] }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await startEpdrLocalPlaybook(input)).toEqual({ runId: 7, existing: false });
    const compiled = queries();
    expect(compiled[2].sql).toContain("LEFT JOIN devices a ON a.id = e.device_id AND a.site_id = d.site_id");
    expect(compiled[2].sql).toContain("LEFT JOIN incidents i ON i.id = d.incident_id AND i.site_id = d.site_id");
    expect(compiled[2].sql).toContain("e.is_critical OR coalesce(a.is_critical, false)");
    expect(compiled[2].sql).toContain("coalesce(i.automation_hold, false)");
    const insert = compiled.find((q) => q.sql.includes("INSERT INTO epdr_local_playbook_runs"))!;
    const evidence = JSON.parse(insert.params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
    const blocked = flags.hold || !flags.identityKnown;
    expect(evidence.responsePolicy).toMatchObject({
      status: blocked ? "blocked" : "proposed", route: blocked ? null : "operator_incident_pic_review",
      flags: { hold: flags.hold, critical: flags.identityKnown ? flags.critical : null, noAuto: flags.identityKnown ? flags.noAuto : null },
      providerLocked: true, notificationsEnabled: false, automationDelivered: false, operatorReviewRequired: true,
    });
    expect(compiled.filter((q) => /INSERT|UPDATE|DELETE/.test(q.sql) && !q.sql.includes("FOR UPDATE"))
      .every((q) => q.sql.includes("INSERT INTO epdr_local_playbook_"))).toBe(true);
  });
  it("rejects tampered templates before saving routing evidence or steps", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ configuration, definition: { ...definition, template: { ...definition.template, steps: ["isolate"] } } }] })
      .mockResolvedValueOnce({ rows: [{ source: "threatsync", category: "malware", score: 10, detected_at: new Date(), identity_known: true }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await startEpdrLocalPlaybook(input)).toHaveProperty("message");
    expect(queries().every((q) => !q.sql.includes("INSERT"))).toBe(true);
  });
  it("rejects historical detection before idempotency lookup or capturing current-account evidence", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 4 }] })
      .mockResolvedValueOnce({ rows: [{ configuration, definition }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await startEpdrLocalPlaybook(input)).toHaveProperty("message");
    expect(queries()[2].params).toEqual([4, 31, 17, 2, 4]);
    expect(queries().every((q) => !q.sql.includes("INSERT"))).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
  it("returns existing version+detection without modifying evidence or appending steps", async () => {
    startRows(true);
    expect(await startEpdrLocalPlaybook(input)).toEqual({ runId: 7, existing: true });
    expect(queries().every((q) => !q.sql.includes("INSERT"))).toBe(true);
  });
  it("rolls back start after actor revocation", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] });
    mocks.actor.mockRejectedValue(new Error("revoked"));
    expect(await startEpdrLocalPlaybook(input)).toHaveProperty("message");
    expect(queries().every((q) => !q.sql.includes("INSERT"))).toBe(true);
  });
  it("lists bounded site-scoped runs without exposing evidence or other sites", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, version_id: 42, detection_id: 31, status: "finished", created_at: new Date(0), finished_at: new Date(1) }] });
    const result = await getEpdrLocalPlaybookRuns();
    expect(result).toMatchObject({ limit: 50, page: 1, pages: 1, total: 1, rows: [{ id: 7, versionId: 42, detectionId: 31, status: "finished" }] });
    const compiled = queries();
    expect(compiled[0].sql).toContain("count(*)");
    expect(compiled[0].params).toEqual([17]);
    expect(compiled[1].sql).toContain("site_id = $1");
    expect(compiled[1].sql).toContain("LIMIT $2");
    expect(compiled[1].sql).toContain("OFFSET");
    expect(compiled[1].params).toEqual([17, 50, 0]);
  });

  it("pages runs with a bounded offset and clamps an out-of-range page", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ total: 120 }] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 120 }] }).mockResolvedValueOnce({ rows: [] });
    expect(await getEpdrLocalPlaybookRuns({ page: 2 })).toMatchObject({ page: 2, pages: 3, total: 120, rows: [] });
    expect(queries()[1].params).toEqual([17, 50, 50]);
    expect(await getEpdrLocalPlaybookRuns({ page: 99 })).toMatchObject({ page: 3, pages: 3, rows: [] });
    expect(queries()[3].params).toEqual([17, 50, 100]);
  });

  it.each([null, { page: 0 }, { page: 1.5 }, { page: 10001 }, { page: "2" }, { siteId: 9 }, { limit: 500 }])(
    "rejects invalid run page input %j before database access", async (value) => {
      expect(await getEpdrLocalPlaybookRuns(value)).toEqual({ message: "Invalid local run page." });
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

  it("rejects cross-site missing detection or saved version", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 2, account_revision: 3 }] });
    expect(await startEpdrLocalPlaybook(input)).toHaveProperty("message");
    expect(queries().every((q) => !q.sql.includes("INSERT"))).toBe(true);
  });
  it("rechecks current actor AND original requester before reclaiming expired leases", async () => {
    locked(8);
    expect(await resumeEpdrLocalPlaybook(7)).toEqual({ runId: 7, result: "busy_or_finished" });
    expect(mocks.actor.mock.calls.map((c) => c.slice(1))).toEqual([[17, 9], [17, 8]]);
    const claim = queries().find((q) => q.sql.includes("generation = generation + 1"))!;
    expect(claim.sql).toContain("lease_until <= clock_timestamp()");
    expect(queries()[0].sql).toContain("r.account_revision = c.account_revision");
    expect(queries()[0].sql).toContain("r.site_id =");
  });
  it("fails closed after account revision change", async () => {
    expect(await resumeEpdrLocalPlaybook(7)).toHaveProperty("message");
    expect(queries().every((q) => !q.sql.trimStart().startsWith("UPDATE"))).toBe(true);
  });
  it("does not claim when original requester is revoked", async () => {
    locked(8);
    mocks.actor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    expect(await resumeEpdrLocalPlaybook(7)).toHaveProperty("message");
    expect(queries().every((q) => !q.sql.trimStart().startsWith("UPDATE"))).toBe(true);
  });
  it("fences publication and completion separately and enforces durable order", async () => {
    locked();
    mocks.execute.mockResolvedValueOnce({ rows: [{ generation: 3 }] }).mockResolvedValueOnce({ rows: [{ ordinal: 0, kind: "record", action: "evidence", status: "pending" }] });
    locked();
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    locked();
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await resumeEpdrLocalPlaybook(7)).toEqual({ runId: 7, result: "finished" });
    const publication = queries().find((q) => q.sql.includes("UPDATE epdr_local_playbook_steps"))!;
    expect(publication.sql).toContain("r.generation =");
    expect(publication.sql).toContain("r.lease_until > clock_timestamp()");
    expect(publication.sql).toContain("prior.ordinal < s.ordinal");
    expect(mocks.actor).toHaveBeenCalledTimes(3);
  });
  it("never imports side effect capabilities or updates simulation history", () => {
    const source = readFileSync(new URL("./epdr-local-playbooks.ts", import.meta.url), "utf8");
    const engine = readFileSync(new URL("../lib/epdr/local-playbook-engine.ts", import.meta.url), "utf8");
    expect(source + engine).not.toMatch(/fetch\(|INSERT INTO incidents|from ["'][^"']*dispatcher|createEpdrIncidentHandoff|UPDATE epdr_playbook_versions|UPDATE epdr_playbook_runs/);
  });
  it("migration enforces composite tenancy, idempotency and immutable terminal suppression", () => {
    const migration = readFileSync(new URL("../drizzle/0075_epdr_local_playbook_runs.sql", import.meta.url), "utf8");
    expect(migration).toContain("UNIQUE (site_id, version_id, detection_id)");
    for (const table of ["epdr_playbook_versions", "epdr_detections", "watchguard_connections", "epdr_local_playbook_runs"]) expect(migration).toContain(`REFERENCES ${table}(id, site_id)`);
    expect(migration).toContain("OLD.status <> 'pending'");
    expect(migration).toContain("kind NOT IN ('notify', 'provider') OR status IN ('pending', 'suppressed')");
  });
});
