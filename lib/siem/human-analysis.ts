import type { SiemFindingCandidate, SiemRuleDefinition } from "./rule-engine";

export type HumanAnalysisInput = {
  candidate: SiemFindingCandidate;
  rule: Pick<SiemRuleDefinition, "name" | "description" | "category" | "severity" | "ruleType" | "threshold" | "windowSeconds" | "groupBy">;
};

function formatWindow(seconds: number | null) {
  if (!seconds) return "single event";
  if (seconds % 60 === 0) return `${seconds / 60} minute window`;
  return `${seconds} second window`;
}

function scope(candidate: SiemFindingCandidate) {
  const parts = [
    candidate.deviceId ? `device #${candidate.deviceId}` : null,
    candidate.sourceId ? `source #${candidate.sourceId}` : null,
    candidate.siteId ? `site #${candidate.siteId}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "unmapped source context";
}

export function buildHumanAnalysis(input: HumanAnalysisInput) {
  const { candidate, rule } = input;
  const windowText = formatWindow(rule.windowSeconds);
  const firstSeen = candidate.firstSeenAt.toISOString();
  const lastSeen = candidate.lastSeenAt.toISOString();

  return [
    `${rule.severity} ${rule.category} finding: ${rule.name}.`,
    `${candidate.eventCount} matching event(s) were observed for ${scope(candidate)} in ${windowText}.`,
    `First seen ${firstSeen}; last seen ${lastSeen}.`,
    `Rule evidence: ${rule.description}`,
  ].join(" ");
}

export function buildRecommendedAction(input: HumanAnalysisInput) {
  const { candidate, rule } = input;
  if (!candidate.deviceId) return "Map the syslog source to a device before creating or escalating an incident.";
  if (rule.category === "Authentication") return "Review login source, username, and recent access changes; disable or rotate affected credentials if unauthorized access is confirmed.";
  if (rule.category === "Firewall") return "Review firewall session details, source reputation in internal context, and affected destination before blocking or allowing traffic.";
  if (rule.category === "Network") return "Check affected interface, cabling, upstream dependency, and recent configuration changes before replacing hardware.";
  if (rule.category === "System") return "Check device health, recent reboot/configuration history, and power or thermal state before scheduling maintenance.";
  if (rule.category === "SIEM Health") return "Verify receiver, parser, and source availability before treating this as a device incident.";
  return "Review matching events and confirm impact before taking remediation action.";
}

export function buildFindingText(input: HumanAnalysisInput) {
  return {
    humanAnalysis: buildHumanAnalysis(input),
    recommendedAction: buildRecommendedAction(input),
  };
}
