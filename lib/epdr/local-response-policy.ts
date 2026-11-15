import { planLocalPlaybook, type LocalPlan } from "./local-playbook-engine";
import { evaluatePlaybook, PLAYBOOK_TEMPLATES, scorePolicyProposal, type PlaybookSignal } from "./playbooks";

export type LocalResponseFlags = { hold: boolean | null; critical: boolean | null; noAuto: boolean | null };
export type LocalResponseRoute = "record_digest_proposal" | "correlation_review" | "operator_incident_pic_review" | "priority_escalation_review";
export type LocalResponseBlock = "unsupported" | "identity" | "partial" | "stale" | "hold" | "unknown_flags";
/** Immutable recommendation evidence, not a command, delivery receipt, or automation authorization. */
export type LocalResponsePolicy = {
  schemaVersion: 1;
  scope: "local_review_recommendation";
  tier: ReturnType<typeof scorePolicyProposal>;
  status: "proposed" | "blocked";
  route: LocalResponseRoute | null;
  reasons: LocalResponseBlock[];
  flags: LocalResponseFlags;
  operatorReviewRequired: true;
  providerLocked: true;
  notificationsEnabled: false;
  automationDelivered: false;
};

/** Pure routing only. A missing score is valid, but unknown identity/evidence is never eligible. */
export function evaluateLocalResponsePolicy(signal: PlaybookSignal, flags: LocalResponseFlags, now: number): LocalResponsePolicy {
  const tier = scorePolicyProposal(signal.score);
  const template = PLAYBOOK_TEMPLATES.find((item) => item.previewAvailable &&
    item.sources.some((source) => source === signal.source) && item.categories?.some((category) => category === signal.category));
  const reasons: LocalResponseBlock[] = [];
  if (!template) reasons.push("unsupported");
  else {
    const eligibility = evaluatePlaybook(template, signal, now);
    if (eligibility.reason !== "eligible") reasons.push(eligibility.reason === "criteria" ? "unsupported" : eligibility.reason);
  }
  if (flags.hold === true) reasons.push("hold");
  if ([flags.hold, flags.critical, flags.noAuto].some((flag) => typeof flag !== "boolean")) reasons.push("unknown_flags");
  const route: LocalResponseRoute = tier === "4-6" ? "correlation_review" : tier === "7-8" ? "operator_incident_pic_review" :
    tier === "9-10" ? "priority_escalation_review" : "record_digest_proposal";
  return {
    schemaVersion: 1, scope: "local_review_recommendation", tier,
    status: reasons.length ? "blocked" : "proposed", route: reasons.length ? null : route, reasons,
    flags: { ...flags }, operatorReviewRequired: true, providerLocked: true,
    notificationsEnabled: false, automationDelivered: false,
  };
}

/** Validate saved configuration AND exact catalog definition before attaching routing evidence.
 * Recommendations never add steps to the template or turn inert simulation actions into work.
 */
export function planLocalResponse(configuration: unknown, definition: unknown, signal: PlaybookSignal, flags: LocalResponseFlags, now: number): LocalPlan & { responsePolicy: LocalResponsePolicy } {
  const plan = planLocalPlaybook(configuration, definition, signal, now);
  return { ...plan, responsePolicy: evaluateLocalResponsePolicy(signal, flags, now) };
}
