import { describe, expect, it } from "vitest";
import { evaluateResponse } from "./response-policy";
import { PLAYBOOK_TEMPLATES, type PlaybookSignal } from "./playbooks";
const template = PLAYBOOK_TEMPLATES.find((t) => t.id === "malware-virus")!;
const config = { templateId: template.id, name: "Saved", mode: "simulate", filters: { source: "all", category: "all", score: "all", minScore: 1, maxScore: 10 } };
const definition = { schemaVersion: 1, template };
const signal: PlaybookSignal = { source: "threatsync", category: "malware", score: 9, identityKnown: true, completeness: { source: "threatsync", status: "verified" }, observedAt: 1000, syncedAt: 1000 };
const flags = { hold: false, critical: false, noAuto: false };
describe("response policy", () => {
  it.each(["scan", "isolate"] as const)("recommends %s without changing simulation or dispatching", (response) => {
    const result = evaluateResponse(config, definition, response, signal, flags, 1000);
    expect(result.status).toBe("matched");
    expect(result.providerLocked).toBe(true);
    expect(result.operatorRequestRequired).toBe(true);
    expect(config.mode).toBe("simulate");
  });
  it.each([
    [{ ...signal, identityKnown: false }, flags, "identity"],
    [{ ...signal, completeness: { source: "threatsync", status: "partial" } }, flags, "partial"],
    [signal, { ...flags, hold: true }, "hold"],
    [signal, { ...flags, noAuto: true }, "no_auto"],
    [signal, { ...flags, critical: true }, "critical_endpoint"],
  ] as const)("blocks unsafe evidence", (input, controls, reason) => {
    const result = evaluateResponse(config, definition, "isolate", input, controls, 1000);
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain(reason);
  });
  it("refuses changed immutable definitions", () => {
    expect(() => evaluateResponse(config, {}, "scan", signal, flags, 1000)).toThrow("version_definition_changed");
  });
});
