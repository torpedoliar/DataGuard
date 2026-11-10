/**
 * Canonical EPDR action types.
 *
 * Single source across tickets (global `allowed_actions` ceiling, rule
 * `action_type`, typed action states and the dispatcher). Adding a value here
 * does not enable it; the dispatcher and the global settings ceiling decide
 * what is dispatchable. Under the read-only lock every value is a blocked
 * adapter on the real transport.
 */
export const EPDR_ACTION_TYPES = [
  "scan",
  "reboot",
  "assign_config",
  "isolate",
  "unisolate",
  "ts_kill_process",
  "ts_quarantine",
  "ts_block_ip",
  "ts_unblock_ip",
] as const;

export type EpdrActionType = (typeof EPDR_ACTION_TYPES)[number];

export function isEpdrActionType(value: unknown): value is EpdrActionType {
  return typeof value === "string" && (EPDR_ACTION_TYPES as readonly string[]).includes(value);
}