/**
 * Protection-health classification + ladder (T09). Pure — no DB, no network.
 * The ladder only detects/reboots/escalates/manual-falls-back; the public API
 * has no repair/reinstall command (spec §3.3), so "repair protection/agent"
 * stays an explicit manual handoff, never a silently-substituted action.
 */

export type HealthProblem =
  | "none"
  | "disabled"
  | "error"
  | "install_error"
  | "no_license"
  | "unknown_status"
  | "pending_restart"
  | "outdated";

export type EndpointHealth = {
  accumulatedProtectionStatus: number | null;
  protectionEngineUpdateStatus: number | null;
  knowledgeCatalogUpdateStatus: number | null;
  rebootRequested: boolean | null;
  lastConnectionAt: Date | null;
};

export const OFFLINE_FREEZE_DAYS = 3;

export function classifyHealth(endpoint: EndpointHealth, nowMs: number): { problem: HealthProblem; offline: boolean } {
  const days = endpoint.lastConnectionAt ? (nowMs - endpoint.lastConnectionAt.getTime()) / (24 * 60 * 60 * 1000) : null;
  const offline = days !== null && days > OFFLINE_FREEZE_DAYS;

  const status = endpoint.accumulatedProtectionStatus;
  if (status === 1) {
    const pendingRestart = endpoint.protectionEngineUpdateStatus === 3 || endpoint.rebootRequested === true;
    const outdated = endpoint.protectionEngineUpdateStatus === 1 || endpoint.knowledgeCatalogUpdateStatus === 1;
    if (pendingRestart) return { problem: "pending_restart", offline };
    if (outdated) return { problem: "outdated", offline };
    return { problem: "none", offline };
  }
  if (status === 2) return { problem: "disabled", offline };
  if (status === 3) return { problem: "error", offline };
  if (status === 4) return { problem: "install_error", offline };
  if (status === 5) return { problem: "no_license", offline };
  return { problem: "unknown_status", offline };
}

export type HealthSettings = {
  graceMinutes: number;
  stageWaitMinutes: number;
  stableMinutes: number;
  rebootMode: "off" | "approval" | "automatic";
};

export type HealthCase = {
  stage: number;
  stageChangedAt: Date;
  healthySince: Date | null;
  currentProblem: HealthProblem;
};

export type LadderAction =
  | { kind: "hold" }
  | { kind: "propose_reboot"; mode: "approval" | "automatic" }
  | { kind: "escalate"; targetStage: 2 | 3 }
  | { kind: "close" };

export function advanceHealthStage(
  input: { problem: HealthProblem; offline: boolean; rebootFlag: boolean },
  existing: HealthCase | null,
  settings: HealthSettings,
  nowMs: number,
): { action: LadderAction; nextStage: number } {
  // Healthy (fresh + stable) → close an open case.
  if (input.problem === "none") {
    const stableSince = existing?.healthySince?.getTime() ?? nowMs;
    if (existing && nowMs - stableSince >= settings.stableMinutes * 60 * 1000) {
      return { action: { kind: "close" }, nextStage: 0 };
    }
    return { action: { kind: "hold" }, nextStage: existing?.stage ?? 0 };
  }

  // Offline endpoints never advance stages (they surface in the offline list).
  if (input.offline) return { action: { kind: "hold" }, nextStage: existing?.stage ?? 0 };

  if (!existing) {
    // New problem opens at stage 0; grace must elapse before advancing.
    return { action: { kind: "hold" }, nextStage: 0 };
  }

  const stageAgeMs = nowMs - existing.stageChangedAt.getTime();
  const graceMs = settings.graceMinutes * 60 * 1000;
  const stageWaitMs = settings.stageWaitMinutes * 60 * 1000;

  if (existing.stage === 0) {
    if (stageAgeMs < graceMs) return { action: { kind: "hold" }, nextStage: 0 };
    if (input.rebootFlag && settings.rebootMode !== "off") {
      return { action: { kind: "propose_reboot", mode: settings.rebootMode }, nextStage: 1 };
    }
    return { action: { kind: "escalate", targetStage: 2 }, nextStage: 2 };
  }

  if (existing.stage === 1) {
    if (stageAgeMs < stageWaitMs) return { action: { kind: "hold" }, nextStage: 1 };
    return { action: { kind: "escalate", targetStage: 2 }, nextStage: 2 };
  }

  if (existing.stage === 2) {
    if (stageAgeMs < stageWaitMs) return { action: { kind: "hold" }, nextStage: 2 };
    return { action: { kind: "escalate", targetStage: 3 }, nextStage: 3 };
  }

  return { action: { kind: "hold" }, nextStage: existing.stage };
}