import { describe, expect, it } from "vitest";
import { evaluateOperationalPlaybook as evaluate, OPERATIONAL_TEMPLATES, storedIntegrationOk, type OperationalEvidence, type OperationalTemplate } from "./operational-playbooks";
import { PLAYBOOK_FRESHNESS_MS as day } from "./playbooks";
const now = 10 * day;
const endpoint: OperationalEvidence = { source: "endpoint", id: 1, observedAt: now, identityKnown: true, protection: 1, engineUpdate: 0, catalogUpdate: 0, rebootRequested: false, lastConnectionAt: now };
describe("operational observation templates", () => {
  it.each<[OperationalTemplate, Partial<OperationalEvidence>]>([
    ["protection-off", { protection: 2 }], ["error", { protection: 3 }], ["error", { protection: 4 }],
    ["offline", { lastConnectionAt: now - 4 * day }], ["update", { engineUpdate: 1 }],
    ["update", { engineUpdate: 3 }], ["license", { protection: 5 }],
    ["integration", { source: "connection", integrationOk: false }],
    ["sla", { source: "incident", incidentStatus: "Open", dueAt: now - 1 }], ["recovery", {}],
  ])("matches %s without commands or closure", (template, fields) => {
    expect(evaluate(template, { ...endpoint, ...fields }, now)).toEqual({ status: "matched", reason: "observation", providerLocked: true, observationOnly: true });
  });
  it.each(["protection-off", "error", "offline", "update", "license"] as const)("does not match healthy %s", (template) => {
    expect(evaluate(template, endpoint, now).status).toBe("no_match");
  });
  it.each(OPERATIONAL_TEMPLATES)("blocks stale/future/unknown observation or identity for %s", (template) => {
    const source = template === "integration" ? "connection" : template === "sla" ? "incident" : "endpoint";
    for (const observedAt of [null, NaN, now + 1, now - day - 1]) expect(evaluate(template, { ...endpoint, source, observedAt }, now).status).toBe("blocked");
    expect(evaluate(template, { ...endpoint, source, identityKnown: false }, now).reason).toBe("identity");
  });
  it("never treats null or unknown signals as known healthy", () => {
    for (const protection of [null, 0, 99]) for (const template of ["protection-off", "error", "license", "recovery"] as const) expect(evaluate(template, { ...endpoint, protection }, now).reason).toBe("unknown");
    for (const engineUpdate of [null, 99]) expect(evaluate("update", { ...endpoint, engineUpdate }, now).status).toBe("blocked");
    for (const lastConnectionAt of [null, NaN, now + 1]) expect(evaluate("offline", { ...endpoint, lastConnectionAt }, now).status).toBe("blocked");
    expect(evaluate("recovery", { ...endpoint, rebootRequested: null }, now).status).toBe("blocked");
    expect(evaluate("integration", { ...endpoint, source: "connection", integrationOk: null }, now).status).toBe("blocked");
    expect(evaluate("sla", { ...endpoint, source: "incident", dueAt: null }, now).status).toBe("blocked");
  });
  it("does not classify resolved incidents as SLA breaches or unhealthy endpoints as recovered", () => {
    expect(evaluate("sla", { ...endpoint, source: "incident", incidentStatus: "Resolved", dueAt: now - 1 }, now).status).toBe("no_match");
    expect(evaluate("recovery", { ...endpoint, protection: 3 }, now).status).toBe("no_match");
    expect(evaluate("sla", endpoint, now).status).toBe("no_match");
  });
  it("accepts only explicit stored integration checks", () => {
    for (const value of [null, {}, { configured: false }, { configured: true, read: {} }, { configured: true, read: { endpoint: {} } }]) expect(storedIntegrationOk(value)).toBeNull();
    expect(storedIntegrationOk({ configured: true, read: { endpoint: { ok: true } } })).toBe(true);
    expect(storedIntegrationOk({ configured: true, read: { endpoint: { ok: false } } })).toBe(false);
  });
});
