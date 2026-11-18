/**
 * Canonical EPDR action types.
 *
 * Single source across tickets (global `allowed_actions` ceiling, rule
 * `action_type`, typed action states and the dispatcher). Adding a value here
 * does not enable it: `lib/epdr/execution-capability.ts` decides which actions
 * have a verified provider contract, and the runtime enablement, per-site
 * allowlist, approval and kill switches decide whether one may be sent.
 *
 * Endpoint Security and ThreatSync actions are deliberately separate values so
 * an Endpoint Security device id can never be used as a ThreatSync entity id.
 */
export const EPDR_ACTION_TYPES = [
  // Endpoint Security (device_id namespace)
  "scan",
  "reboot",
  "assign_config",
  "isolate",
  "unisolate",
  // ThreatSync (entity id namespace)
  "ts_isolate",
  "ts_unisolate",
  "ts_kill_process",
  "ts_quarantine",
  "ts_block_ip",
  "ts_unblock_ip",
  "ts_incident_status",
] as const;

export type EpdrActionType = (typeof EPDR_ACTION_TYPES)[number];

export function isEpdrActionType(value: unknown): value is EpdrActionType {
  return typeof value === "string" && (EPDR_ACTION_TYPES as readonly string[]).includes(value);
}
