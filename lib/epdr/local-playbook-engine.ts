import { isDeepStrictEqual } from "node:util";
import { playbookConfigMatches, playbookConfigSchema } from "./playbook-config";
import { evaluatePlaybook, PLAYBOOK_TEMPLATES, type PlaybookSignal } from "./playbooks";

export type LocalStepKind = "record" | "review" | "incident" | "handoff" | "notify" | "provider";
export type LocalOutcome = { status: "recorded" | "requires_operator" | "suppressed"; reason: string };
export type LocalStep = { ordinal: number; kind: LocalStepKind; action: string; status: "pending" | LocalOutcome["status"] };
export type LocalPlan = { eligibility: ReturnType<typeof evaluatePlaybook>; steps: LocalStep[] };

/** A local record is useful even when remediation is blocked. Never upgrades incomplete evidence. */
export function planLocalPlaybook(configuration: unknown, definition: unknown, signal: PlaybookSignal, now: number): LocalPlan {
  const config = playbookConfigSchema.parse(configuration);
  const template = PLAYBOOK_TEMPLATES.find((item) => item.id === config.templateId);
  if (!template || !isDeepStrictEqual(definition, { schemaVersion: 1, template })) throw new Error("version_definition_changed");
  if (!playbookConfigMatches(config, signal)) throw new Error("detection_outside_configuration");
  const eligibility = evaluatePlaybook(template, signal, now);
  if (eligibility.status === "no_match" || eligibility.reason === "unsupported") throw new Error("detection_outside_template");
  const steps: LocalStep[] = [{ ordinal: 0, kind: "record", action: "evidence", status: "pending" }];
  for (const action of template.steps) {
    const kind: LocalStepKind = action === "scan" || action === "isolate" ? "provider" : action;
    steps.push({ ordinal: steps.length, kind, action, status: "pending" });
  }
  return { eligibility, steps };
}

/** Intentionally no dispatch, Incident mutation, or notification capability in this runner. */
export function localStepOutcome(step: LocalStep): LocalOutcome {
  switch (step.kind) {
    case "record": return { status: "recorded", reason: "immutable_evidence_saved" };
    case "review": return { status: "recorded", reason: "explicit_admin_review_requested_not_resolved" };
    case "incident":
    case "handoff": return { status: "requires_operator", reason: "use_explicit_local_incident_handoff" };
    case "notify": return { status: "suppressed", reason: "notifications_disabled" };
    case "provider": return { status: "suppressed", reason: "provider_execution_disabled" };
  }
}
export type LocalClaim = { generation: number; steps: LocalStep[] };
export type LocalRunnerDeps = {
  /** Atomic CAS; recheck actor, site, original requester and captured account revision. */
  claim(): Promise<LocalClaim | null>;
  /** CAS-fenced publication, same authorization recheck. False means stop immediately. */
  publish(generation: number, ordinal: number, outcome: LocalOutcome): Promise<boolean>;
  finish(generation: number): Promise<boolean>;
};
export async function runLocalPlaybook(deps: LocalRunnerDeps): Promise<"finished" | "busy_or_finished" | "fenced"> {
  const claim = await deps.claim();
  if (!claim) return "busy_or_finished";
  for (const step of [...claim.steps].sort((a, b) => a.ordinal - b.ordinal)) {
    // Persisted terminal outcomes, particularly suppressed actions, are never replayed.
    if (step.status !== "pending") continue;
    if (!await deps.publish(claim.generation, step.ordinal, localStepOutcome(step))) return "fenced";
  }
  return await deps.finish(claim.generation) ? "finished" : "fenced";
}
