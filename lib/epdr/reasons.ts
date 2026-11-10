/**
 * Canonical EPDR policy/decision reason codes (T06). Every evaluation reason
 * is one of these codes so the UI can translate it.
 */
export const EPDR_REASON_CODES = [
  "no_match",
  "block_kill_switch_global",
  "block_kill_switch_site",
  "block_action_not_allowed",
  "block_automation_hold",
  "block_endpoint_removed",
  "block_endpoint_offline",
  "block_data_stale",
  "block_cooldown",
  "block_exclusion",
  "approval_server",
  "approval_critical",
  "approval_no_auto",
  "approval_unknown_type",
  "approval_unresolved_target",
  "breaker_paused",
  "simulated",
] as const;

export type EpdrReasonCode = (typeof EPDR_REASON_CODES)[number];