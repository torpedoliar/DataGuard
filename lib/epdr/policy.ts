/**
 * Response-rule policy evaluation (T06). Pure — no DB, no network. Given a
 * detection + endpoint + incident + rule + site/global controls, return the
 * decision (simulated | needs_approval | automatic | blocked | no_match) and
 * the ordered reason codes.
 */
import type { EpdrReasonCode } from "./reasons";

export type RuleInput = {
  enabled: boolean;
  trigger: "detection" | "health";
  categories: string[];
  minScore: number | null;
  maxScore: number | null;
  deviceTypes: number[];
  actionType: string;
  executionMode: "simulate" | "approval" | "automatic";
};

export type EndpointInput = {
  deviceType: number | null;
  isCritical: boolean;
  assetCritical: boolean;
  noAuto: boolean;
  removedAt: Date | null;
  lastConnectionAt: Date | null;
  resolvedTarget: boolean;
};

export type IncidentInput = {
  automationHold: boolean;
  exclusionActive: boolean;
};

export type SiteControls = {
  killSwitch: boolean;
  breakerPaused: boolean;
  dataStale: boolean;
};

export type GlobalControls = {
  killSwitch: boolean;
  allowedActions: string[];
};

export type EvaluateDecision = "simulated" | "needs_approval" | "automatic" | "blocked" | "no_match";

export type EvaluateResult = {
  decision: EvaluateDecision;
  effectiveMode: "simulate" | "approval" | "automatic";
  reasons: { code: EpdrReasonCode; detail: string }[];
};

export type EvaluateInput = {
  detection: { category: string; threatScore: number | null };
  endpoint: EndpointInput;
  incident: IncidentInput;
  rule: RuleInput;
  site: SiteControls;
  global: GlobalControls;
  nowMs: number;
  cooldownActive: boolean;
};

const SERVER_TYPE = 3;
const OFFLINE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function matches(rule: RuleInput, category: string, threatScore: number | null, deviceType: number | null): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger !== "detection") return false;
  if (rule.categories.length > 0 && !rule.categories.includes(category)) return false;
  if (rule.minScore !== null && (threatScore === null || threatScore < rule.minScore)) return false;
  if (rule.maxScore !== null && (threatScore === null || threatScore > rule.maxScore)) return false;
  if (rule.deviceTypes.length > 0 && deviceType !== null && !rule.deviceTypes.includes(deviceType)) return false;
  return true;
}

export function evaluate(input: EvaluateInput): EvaluateResult {
  const { rule, endpoint, incident, site, global } = input;
  const reasons: { code: EpdrReasonCode; detail: string }[] = [];
  // READ_ONLY_SAFEGUARD: requested modes are configuration, never permission
  // to dispatch. There is deliberately no caller/config/environment unlock.
  const effectiveMode = "simulate" as const;

  if (!matches(rule, input.detection.category, input.detection.threatScore, endpoint.deviceType)) {
    return { decision: "no_match", effectiveMode, reasons: [{ code: "no_match", detail: "rule does not match" }] };
  }

  if (global.killSwitch) return { decision: "blocked", effectiveMode, reasons: [{ code: "block_kill_switch_global", detail: "global kill switch" }] };
  if (site.killSwitch) return { decision: "blocked", effectiveMode, reasons: [{ code: "block_kill_switch_site", detail: "site kill switch" }] };
  if (!global.allowedActions.includes(rule.actionType)) return { decision: "blocked", effectiveMode, reasons: [{ code: "block_action_not_allowed", detail: rule.actionType }] };
  if (incident.automationHold) return { decision: "blocked", effectiveMode, reasons: [{ code: "block_automation_hold", detail: "incident held" }] };

  const blocking: { code: EpdrReasonCode; detail: string }[] = [];
  if (endpoint.removedAt !== null) blocking.push({ code: "block_endpoint_removed", detail: "endpoint removed" });
  // Keep the legacy reason code for typed consumers; unresolved identity is a
  // hard block, not an approvable exception (including in simulation).
  if (!endpoint.resolvedTarget) blocking.push({ code: "approval_unresolved_target", detail: "blocked until target identity and site are validated; approval cannot bypass" });
  const lastConnectionMs = endpoint.lastConnectionAt?.getTime();
  if (lastConnectionMs === undefined) {
    blocking.push({ code: "block_endpoint_offline", detail: "last contact unknown" });
  } else if (!Number.isFinite(lastConnectionMs) || !Number.isFinite(input.nowMs) || lastConnectionMs > input.nowMs) {
    blocking.push({ code: "block_data_stale", detail: "invalid or future last contact timestamp" });
  } else if (input.nowMs - lastConnectionMs > OFFLINE_THRESHOLD_MS) {
    blocking.push({ code: "block_endpoint_offline", detail: "offline > 7 days" });
  }
  if (site.dataStale) blocking.push({ code: "block_data_stale", detail: "sync data stale" });
  if (input.cooldownActive) blocking.push({ code: "block_cooldown", detail: "within cooldown" });
  if (incident.exclusionActive) blocking.push({ code: "block_exclusion", detail: "active exclusion" });
  if (blocking.length > 0) {
    return { decision: "blocked", effectiveMode, reasons: blocking };
  }

  // Preserve would-be approval guardrails as provenance, not dispatchable
  // proposals. Read-only applies to every requested mode and action type.
  if (endpoint.deviceType === SERVER_TYPE) reasons.push({ code: "approval_server", detail: "server would require approval" });
  if (endpoint.isCritical || endpoint.assetCritical) reasons.push({ code: "approval_critical", detail: "critical target would require approval" });
  if (endpoint.noAuto) reasons.push({ code: "approval_no_auto", detail: "no_auto would require approval" });
  if (endpoint.deviceType === null) reasons.push({ code: "approval_unknown_type", detail: "unknown type would require approval" });
  if (rule.executionMode === "approval") reasons.push({ code: "approval_no_auto", detail: "requested approval mode; approval cannot lift read-only restriction" });
  if (site.breakerPaused) reasons.push({ code: "breaker_paused", detail: "circuit breaker paused" });
  reasons.push({ code: "simulated", detail: `WatchGuard READ-ONLY; requested ${rule.executionMode}; no provider dispatch or replay authorization` });
  return { decision: "simulated", effectiveMode, reasons };
}