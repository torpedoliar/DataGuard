import { PLAYBOOK_FRESHNESS_MS } from "./playbooks";

export const OPERATIONAL_TEMPLATES = ["protection-off", "error", "offline", "update", "license", "integration", "sla", "recovery"] as const;
export type OperationalTemplate = typeof OPERATIONAL_TEMPLATES[number];
export type OperationalEvidence = {
  source: "endpoint" | "connection" | "incident";
  id: number;
  observedAt: number | null;
  identityKnown: boolean;
  protection?: number | null;
  engineUpdate?: number | null;
  catalogUpdate?: number | null;
  rebootRequested?: boolean | null;
  lastConnectionAt?: number | null;
  integrationOk?: boolean | null;
  incidentStatus?: string | null;
  dueAt?: number | null;
};
export type OperationalResult = {
  status: "matched" | "no_match" | "blocked";
  reason: "criteria" | "observation" | "unknown" | "stale" | "identity";
  providerLocked: true;
  observationOnly: true;
};
/** Stored observations only. A healthy reading is not proof of remediation or Incident closure. */
export function evaluateOperationalPlaybook(template: OperationalTemplate, evidence: OperationalEvidence, now: number): OperationalResult {
  const result = (status: OperationalResult["status"], reason: OperationalResult["reason"]): OperationalResult => ({ status, reason, providerLocked: true, observationOnly: true });
  const source = template === "integration" ? "connection" : template === "sla" ? "incident" : "endpoint";
  if (!OPERATIONAL_TEMPLATES.includes(template)) return result("blocked", "unknown");
  if (evidence.source !== source) return result("no_match", "criteria");
  if (!evidence.identityKnown) return result("blocked", "identity");
  if (!Number.isFinite(now) || evidence.observedAt === null || !Number.isFinite(evidence.observedAt) || evidence.observedAt > now || now - evidence.observedAt > PLAYBOOK_FRESHNESS_MS) return result("blocked", "stale");
  let matches: boolean;
  if (template === "integration") {
    if (typeof evidence.integrationOk !== "boolean") return result("blocked", "unknown");
    matches = !evidence.integrationOk;
  } else if (template === "sla") {
    if (!["Open", "In Progress", "Resolved", "Verified"].includes(evidence.incidentStatus ?? "") || evidence.dueAt == null || !Number.isFinite(evidence.dueAt)) return result("blocked", "unknown");
    matches = ["Open", "In Progress"].includes(evidence.incidentStatus!) && evidence.dueAt < now;
  } else if (template === "offline") {
    if (evidence.lastConnectionAt == null || !Number.isFinite(evidence.lastConnectionAt) || evidence.lastConnectionAt > now) return result("blocked", "unknown");
    matches = now - evidence.lastConnectionAt > 3 * PLAYBOOK_FRESHNESS_MS;
  } else {
    if (![1, 2, 3, 4, 5].includes(evidence.protection ?? -1)) return result("blocked", "unknown");
    if (template === "update" || template === "recovery") {
      // Only the documented current/outdated/pending-restart update codes are accepted.
      if (![0, 1, 3].includes(evidence.engineUpdate ?? -1) || ![0, 1].includes(evidence.catalogUpdate ?? -1) || typeof evidence.rebootRequested !== "boolean") return result("blocked", "unknown");
      matches = evidence.engineUpdate !== 0 || evidence.catalogUpdate !== 0 || evidence.rebootRequested;
      if (template === "recovery") {
        if (evidence.lastConnectionAt == null || !Number.isFinite(evidence.lastConnectionAt) || evidence.lastConnectionAt > now) return result("blocked", "unknown");
        matches = !matches && evidence.protection === 1 && now - evidence.lastConnectionAt <= 3 * PLAYBOOK_FRESHNESS_MS;
      }
    } else matches = template === "protection-off" ? evidence.protection === 2 : template === "error" ? [3, 4].includes(evidence.protection!) : evidence.protection === 5;
  }
  return result(matches ? "matched" : "no_match", matches ? "observation" : "criteria");
}

/** Do not infer health from an absent error or arbitrary JSON. */
export function storedIntegrationOk(value: unknown): boolean | null {
  if (!value || typeof value !== "object") return null;
  const result = value as { configured?: unknown; read?: unknown };
  if (result.configured !== true || !result.read || typeof result.read !== "object") return null;
  const checks = Object.values(result.read);
  if (!checks.length || checks.some((check) => !check || typeof check !== "object" || typeof (check as { ok?: unknown }).ok !== "boolean")) return null;
  return checks.every((check) => (check as { ok: boolean }).ok);
}
