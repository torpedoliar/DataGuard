import { describe, expect, it } from "vitest";
import { evaluateLocalResponsePolicy, planLocalResponse, type LocalResponseFlags } from "./local-response-policy";
import { PLAYBOOK_FRESHNESS_MS, PLAYBOOK_TEMPLATES, type PlaybookSignal } from "./playbooks";

const now = Date.UTC(2026, 10, 9);
const flags: LocalResponseFlags = { hold: false, critical: false, noAuto: false };
const signal: PlaybookSignal = { source: "threatsync", category: "malware", score: 8, identityKnown: true,
  observedAt: now, syncedAt: now, completeness: { source: "threatsync", status: "verified" } };
const configuration = { templateId: "malware-virus", name: "Review", mode: "simulate", filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 } };
const definition = { schemaVersion: 1, template: PLAYBOOK_TEMPLATES.find((item) => item.id === "malware-virus") };

describe("local response policy recommendation evidence", () => {
  it.each([
    [null, "missing", "record_digest_proposal"], [1, "1-3", "record_digest_proposal"], [3, "1-3", "record_digest_proposal"],
    [4, "4-6", "correlation_review"], [6, "4-6", "correlation_review"],
    [7, "7-8", "operator_incident_pic_review"], [8, "7-8", "operator_incident_pic_review"],
    [9, "9-10", "priority_escalation_review"], [10, "9-10", "priority_escalation_review"],
  ] as const)("routes score %s only as a proposal", (score, tier, route) => {
    expect(evaluateLocalResponsePolicy({ ...signal, score }, flags, now)).toMatchObject({
      tier, route, status: "proposed", reasons: [], operatorReviewRequired: true,
      providerLocked: true, notificationsEnabled: false, automationDelivered: false,
    });
  });
  it.each([0, 11, -1, 1.5, NaN, Infinity])("blocks invalid score %s", (score) => {
    expect(evaluateLocalResponsePolicy({ ...signal, score }, flags, now)).toMatchObject({ status: "blocked", route: null, reasons: ["unsupported"] });
  });
  it.each([
    [{ source: "unknown" }, "unsupported"], [{ category: "unknown" }, "unsupported"],
    [{ source: "event_export", category: "ioa" }, "unsupported"], [{ identityKnown: false }, "identity"],
    [{ completeness: { source: "event_export", status: "verified" } }, "partial"],
    [{ completeness: { source: "threatsync", status: "unknown" } }, "partial"],
    [{ completeness: { source: "threatsync", status: "partial" } }, "partial"],
    [{ syncedAt: null }, "stale"], [{ syncedAt: now - PLAYBOOK_FRESHNESS_MS - 1 }, "stale"],
    [{ observedAt: now - PLAYBOOK_FRESHNESS_MS - 1 }, "stale"], [{ observedAt: now + 1 }, "stale"],
    [{ syncedAt: now + 1 }, "stale"], [{ observedAt: NaN }, "stale"],
  ] satisfies [Partial<PlaybookSignal>, string][])("hardblocks unknown/stale evidence %j", (patch, reason) => {
    expect(evaluateLocalResponsePolicy({ ...signal, ...patch }, flags, now)).toMatchObject({ status: "blocked", route: null, reasons: [reason] });
  });
  it("blocks invalid evaluation time", () => {
    expect(evaluateLocalResponsePolicy(signal, flags, NaN).reasons).toEqual(["stale"]);
  });
  it("hold blocks routing and unknown flags never become false", () => {
    expect(evaluateLocalResponsePolicy(signal, { ...flags, hold: true }, now)).toMatchObject({ status: "blocked", route: null, reasons: ["hold"] });
    expect(evaluateLocalResponsePolicy(signal, { hold: null, critical: null, noAuto: null }, now).reasons).toEqual(["unknown_flags"]);
  });
  it.each([{ ...flags, critical: true }, { ...flags, noAuto: true }, { ...flags, critical: true, noAuto: true }])("preserves restrictive flags without authorizing automation", (safety) => {
    expect(evaluateLocalResponsePolicy(signal, safety, now)).toMatchObject({ flags: safety, operatorReviewRequired: true, providerLocked: true, automationDelivered: false });
  });
  it("validates exact saved template, configuration and detection match before planning", () => {
    expect(() => planLocalResponse(configuration, { ...definition, template: { ...definition.template, steps: ["isolate"] } }, signal, flags, now)).toThrow("version_definition_changed");
    expect(() => planLocalResponse({ ...configuration, filters: { ...configuration.filters, category: "pup" } }, definition, signal, flags, now)).toThrow("detection_outside_configuration");
    expect(() => planLocalResponse(configuration, definition, { ...signal, category: "pup" }, flags, now)).toThrow("detection_outside_template");
  });
  it("adds evidence only, never score-derived steps or delivered automation", () => {
    const plan = planLocalResponse(configuration, definition, { ...signal, score: 10 }, flags, now);
    expect(plan.steps.map(({ action }) => action)).toEqual(["evidence", "review", "incident", "scan"]);
    expect(plan.responsePolicy).toMatchObject({ route: "priority_escalation_review", automationDelivered: false });
    const blocked = planLocalResponse(configuration, definition, { ...signal, syncedAt: null }, flags, now);
    expect(blocked.responsePolicy).toMatchObject({ status: "blocked", route: null });
    expect(blocked.steps).toEqual(plan.steps);
  });
});
