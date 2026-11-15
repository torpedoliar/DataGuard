import { describe, expect, it } from "vitest";
import { PLAYBOOK_TEMPLATES, evaluatePlaybook, matchesPlaybookFilters, scorePolicyProposal, type PlaybookSignal } from "./playbooks";
const now = Date.UTC(2026, 0, 1);
const signal: PlaybookSignal = { source: "threatsync", category: "ioa", score: 8, identityKnown: true, completeness: { source: "threatsync", status: "verified" }, observedAt: now, syncedAt: now };
const template = PLAYBOOK_TEMPLATES[4];
describe("simulation-only playbooks", () => {
  it("has 12 unique local templates and all five categories", () => {
    expect(PLAYBOOK_TEMPLATES).toHaveLength(12);
    expect(new Set(PLAYBOOK_TEMPLATES.map((t) => t.id)).size).toBe(12);
    expect(new Set(PLAYBOOK_TEMPLATES.flatMap((t) => t.categories ?? [])).size).toBe(5);
  });
  it("distinguishes matched from simulated and keeps every step inert", () => {
    expect(evaluatePlaybook(template, signal, now).status).toBe("matched");
    const result = evaluatePlaybook(template, signal, now, true);
    expect(result.status).toBe("simulated");
    expect(result.providerLocked).toBe(true);
    expect(result.steps).toEqual(template.steps.map((step) => ({ step, state: "inert" })));
  });
  it.each([
    [{ identityKnown: false }, "identity"], [{ completeness: { source: "threatsync", status: "partial" as const } }, "partial"],
    [{ completeness: { source: "event_export", status: "verified" as const } }, "partial"],
    [{ completeness: { source: "threatsync", status: "unknown" as const } }, "partial"],
    [{ syncedAt: null }, "stale"], [{ observedAt: now - 86400001 }, "stale"],
    [{ syncedAt: now + 1 }, "stale"], [{ observedAt: NaN }, "stale"],
    [{ category: "unknown" }, "unsupported"],
    [{ source: "unknown" }, "unsupported"], [{ score: 0 }, "unsupported"], [{ score: 11 }, "unsupported"],
  ])("hard-blocks unsafe evidence %j", (override, reason) => {
    expect(evaluatePlaybook(template, { ...signal, ...override }, now, true)).toMatchObject({ status: "blocked", reason, providerLocked: true, steps: [] });
  });
  it("returns no_match before unrelated identity, completeness or freshness guards", () => {
    const unsafe = { ...signal, identityKnown: false, completeness: { source: "threatsync", status: "unknown" as const }, syncedAt: null, observedAt: NaN };
    expect(evaluatePlaybook(template, { ...unsafe, category: "virus" }, now, true)).toMatchObject({ status: "no_match", reason: "criteria", steps: [] });
    expect(evaluatePlaybook(template, { ...unsafe, source: "event_export" }, now, true)).toMatchObject({ status: "no_match", reason: "criteria", steps: [] });
  });
  it("does not use missing scores as zero or authorize by severity", () => {
    expect(scorePolicyProposal(null)).toBe("missing");
    expect(evaluatePlaybook(template, { ...signal, category: "virus" }, now).status).toBe("no_match");
    expect(evaluatePlaybook(PLAYBOOK_TEMPLATES[10], signal, now).reason).toBe("unsupported");
  });
  it("filters score ranges separately from missing, category and source", () => {
    expect(matchesPlaybookFilters(signal, { category: "ioa", source: "threatsync", score: "range", minScore: 7, maxScore: 8 })).toBe(true);
    expect(matchesPlaybookFilters(signal, { category: "all", source: "all", score: "missing", minScore: 1, maxScore: 10 })).toBe(false);
    expect(matchesPlaybookFilters({ ...signal, score: null }, { category: "all", source: "all", score: "missing", minScore: 1, maxScore: 10 })).toBe(true);
    expect(matchesPlaybookFilters({ ...signal, score: null }, { category: "all", source: "all", score: "range", minScore: 1, maxScore: 3 })).toBe(false);
  });
  it("uses exactly the approved catalog with nullable health/local categories", () => {
    expect(PLAYBOOK_TEMPLATES.map((t) => t.id)).toEqual(["protection-off", "error", "offline", "malware-virus", "ioa", "exploit", "pup", "update", "license", "integration", "sla", "recovery"]);
    expect(PLAYBOOK_TEMPLATES.filter((t) => !t.previewAvailable).every((t) => t.categories === null)).toBe(true);
    expect(template.sources).toEqual(["threatsync"]);
    for (const category of ["malware", "virus"]) expect(evaluatePlaybook(PLAYBOOK_TEMPLATES[3], { ...signal, category }, now).status).toBe("matched");
    expect(evaluatePlaybook(template, { ...signal, source: "event_export" }, now).status).toBe("no_match");
  });
  it.each([[1,"1-3"],[3,"1-3"],[4,"4-6"],[6,"4-6"],[7,"7-8"],[8,"7-8"],[9,"9-10"],[10,"9-10"],[null,"missing"],[0,"unsupported"]] as const)("provides proposal evidence for %s", (score, tier) => {
    expect(scorePolicyProposal(score)).toBe(tier);
  });
  it("rejects reversed, fractional and out-of-range filter bounds", () => {
    for (const [minScore,maxScore] of [[8,7],[0,10],[1,11],[1.5,8]]) expect(matchesPlaybookFilters(signal, { category: "all", source: "all", score: "range", minScore, maxScore })).toBe(false);
  });
});
