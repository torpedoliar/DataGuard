import { describe, expect, it } from "vitest";
import { evaluateLocalResponsePolicy } from "./local-response-policy";
import { localStepOutcome, planLocalPlaybook } from "./local-playbook-engine";
import { playbookConfigSchema } from "./playbook-config";
import { LOCAL_REVIEW_CAPABILITIES, localStepCapability } from "./local-capabilities";
import { PLAYBOOK_TEMPLATES } from "./playbooks";

describe("local review capability contract", () => {
  it("states the fixed capability boundary", () => {
    expect(LOCAL_REVIEW_CAPABILITIES).toMatchObject({
      localEvidence: "available",
      analystReview: "available",
      incidentHandoff: "available",
      localDecision: "available",
      providerAction: { availability: "suppressed", reason: "provider_execution_disabled" },
      notification: { availability: "disabled", reason: "notifications_disabled" },
      automationDelivered: false,
    });
  });

  it("labels per-step capabilities: evidence steps are available, provider/notify are not inert-but-done", () => {
    expect(localStepCapability("handoff")).toEqual({ availability: "available", reason: null });
    expect(localStepCapability("incident")).toEqual({ availability: "available", reason: null });
    expect(localStepCapability("review")).toEqual({ availability: "available", reason: null });
    expect(localStepCapability("notify")).toEqual({ availability: "disabled", reason: "notifications_disabled" });
    expect(localStepCapability("provider")).toEqual({ availability: "suppressed", reason: "provider_execution_disabled" });
  });

  it("accepts simulate as the only saved configuration mode", () => {
    const template = PLAYBOOK_TEMPLATES[0]!;
    const base = {
      templateId: template.id, name: "review", filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 },
    };
    expect(playbookConfigSchema.safeParse({ ...base, mode: "simulate" }).success).toBe(true);
    for (const mode of ["dispatch", "live", "auto", ""]) {
      expect(playbookConfigSchema.safeParse({ ...base, mode }).success).toBe(false);
    }
  });

  it("always returns the locked, advisory response policy", () => {
    const now = Date.now();
    const signal = { source: "threatsync", category: "malware", score: 8, identityKnown: true, observedAt: now,
      completeness: { source: "threatsync", status: "verified" as const }, syncedAt: now };
    const policy = evaluateLocalResponsePolicy(signal, { hold: false, critical: false, noAuto: false }, now);
    expect(policy.providerLocked).toBe(true);
    expect(policy.notificationsEnabled).toBe(false);
    expect(policy.automationDelivered).toBe(false);
    expect(policy.operatorReviewRequired).toBe(true);
    // A blocked policy never proposes a route.
    const blocked = evaluateLocalResponsePolicy(signal, { hold: true, critical: false, noAuto: false }, now);
    expect(blocked.status).toBe("blocked");
    expect(blocked.route).toBeNull();
    const unsupported = evaluateLocalResponsePolicy(
      { source: "telemetry", category: "other", score: 8, identityKnown: true, observedAt: now,
        completeness: { source: "telemetry", status: "verified" as const }, syncedAt: now },
      { hold: false, critical: false, noAuto: false }, now,
    );
    expect(unsupported.status).toBe("blocked");
    expect(unsupported.route).toBeNull();
  });

  it("keeps provider and notify step outcomes suppressed with their reasons", () => {
    const providerStep = { ordinal: 1, kind: "provider" as const, action: "scan", status: "pending" as const };
    const notifyStep = { ordinal: 2, kind: "notify" as const, action: "notify", status: "pending" as const };
    expect(localStepOutcome(providerStep)).toEqual({ status: "suppressed", reason: "provider_execution_disabled" });
    expect(localStepOutcome(notifyStep)).toEqual({ status: "suppressed", reason: "notifications_disabled" });
    const handoffStep = { ordinal: 3, kind: "handoff" as const, action: "handoff", status: "pending" as const };
    expect(localStepOutcome(handoffStep)).toEqual({ status: "requires_operator", reason: "use_explicit_local_incident_handoff" });
  });

  it("plans steps from a simulate configuration only, mapping provider actions to suppressed steps", () => {
    const now = Date.now();
    const template = PLAYBOOK_TEMPLATES.find((item) => item.id === "malware-virus")!;
    const configuration = { templateId: template.id, name: "review", mode: "simulate", filters: { category: "all", source: "all", score: "all", minScore: 1, maxScore: 10 } };
    const plan = planLocalPlaybook(configuration, { schemaVersion: 1, template },
      { source: "threatsync", category: "malware", score: 8, identityKnown: true, observedAt: now,
        completeness: { source: "threatsync", status: "verified" as const }, syncedAt: now }, now);
    expect(plan.steps.some((step) => step.kind === "provider")).toBe(true);
    expect(plan.steps.every((step) => step.status === "pending")).toBe(true);
  });
});
