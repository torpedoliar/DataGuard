import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: mocks.execute }) } }));
import { evaluateEpdrResponses } from "./response-store";
import { PLAYBOOK_TEMPLATES } from "./playbooks";
import { PgDialect } from "drizzle-orm/pg-core";
const now = new Date();
const cutoff = new Date(now.getTime() - 60000);
const template = PLAYBOOK_TEMPLATES.find((t) => t.id === "malware-virus")!;
const binding = { id: 1, site_id: 2, version_id: 3, connection_id: 4, account_revision: 0, response: "scan", activated_at: cutoff, evaluation_after: cutoff,
  configuration: { templateId: template.id, name: "Saved", mode: "simulate", filters: { source: "all", category: "all", score: "all", minScore: 1, maxScore: 10 } }, definition: { schemaVersion: 1, template } };
const candidate = { id: 5, endpoint_id: 6, source: "threatsync", category: "malware", threat_score: 9, detected_at: new Date(now.getTime() - 1000), provider_id: "device", removed_at: null, is_critical: false, no_auto: false, hold: false };
const attempt = { id: 7, connectionId: 4, accountRevision: 0, credentialRevision: 0, source: "threatsync", status: "completed", window: "threatsync_7d", startedAt: new Date(now.getTime() - 2000), finishedAt: now, eventTypes: [], completedEventTypes: [], settingsUpdatedAt: null };
function setup(read = attempt) {
  mocks.execute.mockResolvedValueOnce({ rows: [{ site_id: 2, account_revision: 0, credential_revision: 0 }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [binding] })
    .mockResolvedValueOnce({ rows: [candidate] }).mockResolvedValueOnce({ rows: [read] });
}
beforeEach(() => vi.clearAllMocks());
describe("completed read response publication", () => {
  it("persists recommendation and immutable policy evidence without execution writes", async () => {
    setup(); mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8 }] });
    expect(await evaluateEpdrResponses(4)).toBe(1);
    expect(mocks.execute).toHaveBeenCalledTimes(6);
  });
  it("does not fall back to old success when latest read failed", async () => {
    setup({ ...attempt, status: "failed" });
    expect(await evaluateEpdrResponses(4)).toBe(0);
    expect(mocks.execute).toHaveBeenCalledTimes(5);
  });
  it("does not backfill a read started before activation/resume", async () => {
    setup({ ...attempt, startedAt: new Date(cutoff.getTime() - 1) });
    expect(await evaluateEpdrResponses(4)).toBe(0);
  });
  it("honors publication deduplication", async () => {
    setup(); mocks.execute.mockResolvedValueOnce({ rows: [] });
    expect(await evaluateEpdrResponses(4)).toBe(0);
  });
  it("filters unusable reads before the limit and fairly rotates prior blocked detections", async () => {
    setup(); mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8 }] });
    await evaluateEpdrResponses(4);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[3][0]).sql;
    expect(query).toContain("JOIN LATERAL");
    expect(query).toContain("ORDER BY a.started_at DESC, a.id DESC LIMIT 1");
    expect(query).toContain("latest_read.status = 'completed'");
    expect(query).toContain("r.read_evidence_id = latest_read.id");
    expect(query).toContain("SELECT max(r.created_at)");
    expect(query).toContain("ASC NULLS FIRST, d.id");
    expect(query.indexOf("latest_read.status")).toBeLessThan(query.lastIndexOf("LIMIT"));
  });
  it("appends a new immutable recommendation for a later read revision", async () => {
    setup(); mocks.execute.mockResolvedValueOnce({ rows: [{ id: 8 }] });
    expect(await evaluateEpdrResponses(4)).toBe(1);
    setup({ ...attempt, id: 9 }); mocks.execute.mockResolvedValueOnce({ rows: [{ id: 10 }] });
    expect(await evaluateEpdrResponses(4)).toBe(1);
    const first = new PgDialect().sqlToQuery(mocks.execute.mock.calls[5][0]);
    const second = new PgDialect().sqlToQuery(mocks.execute.mock.calls[11][0]);
    expect(second.sql).toContain("ON CONFLICT (binding_id, detection_id, read_evidence_id)");
    expect(JSON.parse(first.params.find((p) => typeof p === "string" && p.startsWith('{')) as string).readEvidenceId).toBe(7);
    expect(JSON.parse(second.params.find((p) => typeof p === "string" && p.startsWith('{')) as string).readEvidenceId).toBe(9);
  });
  it("stops on disabled or missing connection", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    expect(await evaluateEpdrResponses(4)).toBe(0);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
