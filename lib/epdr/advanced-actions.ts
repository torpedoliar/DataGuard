/**
 * Advanced (higher-impact) actions (T10). Approval-only: these types can never
 * dispatch automatically. Payloads are built only from stored provider data
 * (isolate/release, assign_config, ThreatSync commands); free-form input is
 * rejected and the read-only transport keeps real execution blocked.
 */
import type { EpdrActionType } from "./action-types";

export const ADVANCED_ACTION_TYPES: readonly EpdrActionType[] = [
  "isolate",
  "unisolate",
  "assign_config",
  "ts_kill_process",
  "ts_quarantine",
  "ts_block_ip",
  "ts_unblock_ip",
];

export function isAdvancedAction(actionType: string): boolean {
  return (ADVANCED_ACTION_TYPES as readonly string[]).includes(actionType);
}

/** Advanced actions are always clamped to approval regardless of rule mode. */
export function clampExecutionMode(actionType: EpdrActionType, mode: "simulate" | "approval" | "automatic"): "simulate" | "approval" | "automatic" {
  if (mode === "simulate") return "simulate";
  return isAdvancedAction(actionType) ? "approval" : mode;
}

export function buildIsolationPayload(deviceIds: string[], message?: string): Record<string, unknown> {
  return { device_ids: deviceIds, customized_message: message ?? null };
}

export function buildAssignConfigPayload(configId: string, deviceIds: string[]): Record<string, unknown> {
  return { config_id: configId, device_ids: deviceIds };
}

export function buildThreatSyncActionPayload(command: string, input: { entityId?: string; parameters?: Record<string, unknown> }): Record<string, unknown> {
  return { command, ...(input.entityId ? { entity_id: input.entityId } : {}), ...(input.parameters ? { parameters: input.parameters } : {}) };
}