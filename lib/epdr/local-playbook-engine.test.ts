import { describe, expect, it, vi } from "vitest";
import { localStepOutcome, planLocalPlaybook, runLocalPlaybook, type LocalStep } from "./local-playbook-engine";
import { PLAYBOOK_TEMPLATES, type PlaybookSignal } from "./playbooks";

const template = PLAYBOOK_TEMPLATES.find((t) => t.id === "malware-virus")!;
const config = { templateId: template.id, name: "Review", mode: "simulate", filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 } };
const definition = { schemaVersion: 1, template };
const now = Date.now();
const signal: PlaybookSignal = { source: "threatsync", category: "malware", score: 8, identityKnown: true, completeness: { source: "threatsync", status: "verified" }, observedAt: now, syncedAt: now };

describe("local planning", () => {
  it("creates ordered typed steps without modifying saved simulation", () => {
    const plan = planLocalPlaybook(config, definition, signal, now);
    expect(plan.steps.map(({ kind }) => kind)).toEqual(["record", "review", "incident", "provider"]);
    expect(plan.eligibility.status).toBe("matched");
    expect(config.mode).toBe("simulate");
  });
  it.each([
    ["partial", { completeness: { source: "threatsync", status: "partial" } }],
    ["partial", { completeness: { source: "event_export", status: "verified" } }],
    ["stale", { syncedAt: null }], ["stale", { observedAt: now + 1 }],
    ["stale", { syncedAt: now + 1 }], ["stale", { observedAt: now - 86400001 }],
    ["identity", { identityKnown: false }],
  ])("retains %s guard in evidence without pretending remediation ran", (reason, overrides) => {
    const plan = planLocalPlaybook(config, definition, { ...signal, ...overrides } as PlaybookSignal, now);
    expect(plan.eligibility).toMatchObject({ status: "blocked", reason, providerLocked: true });
    expect(plan.steps.map(localStepOutcome)).toContainEqual({ status: "requires_operator", reason: "use_explicit_local_incident_handoff" });
  });
  it("rejects changed definitions, nonmatching detections and executable mode", () => {
    expect(() => planLocalPlaybook(config, {}, signal, now)).toThrow();
    expect(() => planLocalPlaybook(config, definition, { ...signal, category: "ioa" }, now)).toThrow();
    expect(() => planLocalPlaybook({ ...config, mode: "execute" }, definition, signal, now)).toThrow();
  });
  it("never enables provider or notification outcomes", () => {
    for (const kind of ["provider", "notify"] as const) expect(localStepOutcome({ ordinal: 0, kind, action: "anything", status: "pending" }).status).toBe("suppressed");
  });
});

describe("resumable local runner", () => {
  it("publishes ordered individual outcomes and skips all previously terminal steps", async () => {
    const steps: LocalStep[] = [
      { ordinal: 2, kind: "provider", action: "scan", status: "suppressed" },
      { ordinal: 1, kind: "review", action: "review", status: "pending" },
      { ordinal: 0, kind: "record", action: "evidence", status: "recorded" },
    ];
    const publish = vi.fn().mockResolvedValue(true);
    const finish = vi.fn().mockResolvedValue(true);
    expect(await runLocalPlaybook({ claim: async () => ({ generation: 4, steps }), publish, finish })).toBe("finished");
    expect(publish).toHaveBeenCalledExactlyOnceWith(4, 1, { status: "recorded", reason: "explicit_admin_review_requested_not_resolved" });
    expect(finish).toHaveBeenCalledWith(4);
  });
  it("stops after a lost fence without later publication", async () => {
    const publish = vi.fn().mockResolvedValue(false);
    const finish = vi.fn();
    expect(await runLocalPlaybook({ claim: async () => ({ generation: 1, steps: planLocalPlaybook(config, definition, signal, now).steps }), publish, finish })).toBe("fenced");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });
  it("does not publish when the claim is busy or terminal", async () => {
    const publish = vi.fn(), finish = vi.fn();
    expect(await runLocalPlaybook({ claim: async () => null, publish, finish })).toBe("busy_or_finished");
    expect(publish).not.toHaveBeenCalled();
  });
});
