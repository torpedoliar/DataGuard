export const PLAYBOOK_CATEGORIES = ["ioa", "malware", "pup", "virus", "exploit"] as const;
export type PlaybookCategory = typeof PLAYBOOK_CATEGORIES[number];
export type PlaybookSource = "threatsync" | "event_export" | "health" | "local";
export type PlaybookTemplate = {
  id: string;
  categories: readonly PlaybookCategory[] | null;
  sources: readonly PlaybookSource[];
  previewAvailable: boolean;
  minScore: number | null;
  localSeverity: "High" | "Medium";
  steps: readonly ("review" | "incident" | "notify" | "scan" | "isolate" | "handoff")[];
};
// Local catalog IDs only: these are never provider task IDs or persisted rules.
export const PLAYBOOK_TEMPLATES: readonly PlaybookTemplate[] = [
  { id: "protection-off", categories: null, sources: ["health"], previewAvailable: false, minScore: null, localSeverity: "High", steps: ["review", "handoff"] },
  { id: "error", categories: null, sources: ["health"], previewAvailable: false, minScore: null, localSeverity: "High", steps: ["review", "handoff"] },
  { id: "offline", categories: null, sources: ["health"], previewAvailable: false, minScore: null, localSeverity: "Medium", steps: ["review", "notify", "handoff"] },
  { id: "malware-virus", categories: ["malware", "virus"], sources: ["threatsync", "event_export"], previewAvailable: true, minScore: null, localSeverity: "High", steps: ["review", "incident", "scan"] },
  { id: "ioa", categories: ["ioa"], sources: ["threatsync"], previewAvailable: true, minScore: null, localSeverity: "High", steps: ["review", "incident", "handoff"] },
  { id: "exploit", categories: ["exploit"], sources: ["threatsync", "event_export"], previewAvailable: true, minScore: null, localSeverity: "High", steps: ["review", "incident", "handoff"] },
  { id: "pup", categories: ["pup"], sources: ["threatsync", "event_export"], previewAvailable: true, minScore: null, localSeverity: "Medium", steps: ["review", "notify"] },
  { id: "update", categories: null, sources: ["health"], previewAvailable: false, minScore: null, localSeverity: "Medium", steps: ["review", "handoff"] },
  { id: "license", categories: null, sources: ["health"], previewAvailable: false, minScore: null, localSeverity: "Medium", steps: ["review", "handoff"] },
  { id: "integration", categories: null, sources: ["local"], previewAvailable: false, minScore: null, localSeverity: "High", steps: ["review", "handoff"] },
  { id: "sla", categories: null, sources: ["local"], previewAvailable: false, minScore: null, localSeverity: "High", steps: ["review", "notify"] },
  { id: "recovery", categories: null, sources: ["local"], previewAvailable: false, minScore: null, localSeverity: "Medium", steps: ["review", "handoff"] },
];
export type PlaybookSignal = {
  source: string;
  category: string;
  score: number | null;
  identityKnown: boolean;
  /** Must describe this detection source, never endpoint/connection health. */
  completeness: { source: string; status: "verified" | "partial" | "unknown" };
  observedAt: number;
  syncedAt: number | null;
};
export type PlaybookResult = {
  status: "matched" | "no_match" | "blocked" | "simulated";
  reason: "eligible" | "criteria" | "identity" | "partial" | "stale" | "unsupported";
  providerLocked: true;
  steps: readonly { step: PlaybookTemplate["steps"][number]; state: "inert" }[];
};
export const PLAYBOOK_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export function evaluatePlaybook(template: PlaybookTemplate, signal: PlaybookSignal, now: number, simulate = false): PlaybookResult {
  const result = (status: PlaybookResult["status"], reason: PlaybookResult["reason"]): PlaybookResult => ({
    status, reason, providerLocked: true,
    steps: status === "simulated" ? template.steps.map((step) => ({ step, state: "inert" })) : [],
  });
  if (!PLAYBOOK_TEMPLATES.includes(template) || !template.previewAvailable ||
      !["threatsync", "event_export"].includes(signal.source) ||
      !PLAYBOOK_CATEGORIES.includes(signal.category as PlaybookCategory) ||
      (signal.score !== null && (!Number.isInteger(signal.score) || signal.score < 1 || signal.score > 10))) return result("blocked", "unsupported");
  // Unrelated detections are not blocked template matches.
  if (!template.sources.includes(signal.source as PlaybookSource) || !template.categories?.includes(signal.category as PlaybookCategory) ||
      (template.minScore !== null && (signal.score === null || signal.score < template.minScore))) return result("no_match", "criteria");
  if (!signal.identityKnown) return result("blocked", "identity");
  if (signal.completeness.source !== signal.source || signal.completeness.status !== "verified") return result("blocked", "partial");
  if (!Number.isFinite(now) || !Number.isFinite(signal.observedAt) || signal.syncedAt === null || !Number.isFinite(signal.syncedAt) ||
      signal.observedAt > now || signal.syncedAt > now || now - signal.observedAt > PLAYBOOK_FRESHNESS_MS || now - signal.syncedAt > PLAYBOOK_FRESHNESS_MS) return result("blocked", "stale");
  return result(simulate ? "simulated" : "matched", "eligible");
}
export type PlaybookFilters = { category: string; source: string; score: "all" | "missing" | "range"; minScore: number; maxScore: number };
export function matchesPlaybookFilters(signal: Pick<PlaybookSignal, "source" | "category" | "score">, filters: PlaybookFilters): boolean {
  if (filters.score === "range" && (!Number.isInteger(filters.minScore) || !Number.isInteger(filters.maxScore) || filters.minScore < 1 || filters.maxScore > 10 || filters.minScore > filters.maxScore)) return false;
  return (filters.category === "all" || filters.category === signal.category) &&
    (filters.source === "all" || filters.source === signal.source) &&
    (filters.score === "all" || (filters.score === "missing" ? signal.score === null : signal.score !== null && Number.isInteger(signal.score) && signal.score >= filters.minScore && signal.score <= filters.maxScore));
}
/** Suggested policy evidence only; never grants execution or returns commands. */
export function scorePolicyProposal(score: number | null): "missing" | "1-3" | "4-6" | "7-8" | "9-10" | "unsupported" {
  if (score === null) return "missing";
  if (!Number.isInteger(score) || score < 1 || score > 10) return "unsupported";
  return score <= 3 ? "1-3" : score <= 6 ? "4-6" : score <= 8 ? "7-8" : "9-10";
}
