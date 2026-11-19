/**
 * Pure helpers for widening the verified EPDR write allowlist (scripts only).
 *
 * Kept out of the script so the parsing/union rules are testable without a
 * database. Only actions with a verified provider contract can pass validation;
 * widening never removes an existing entry.
 */
import { EXECUTABLE_ACTION_TYPES } from "./capabilities";

/** Actions that apply to the endpoint selected in the fleet table. */
export const DEFAULT_WRITE_ACTIONS = ["scan", "isolate", "unisolate", "reboot", "assign_config"] as const;

export type RequestedActions = { requested: string[]; unknown: string[] };

/** Parse a comma-separated `--actions` value, defaulting to the per-device set. */
export function resolveRequestedActions(raw: string | undefined): RequestedActions {
  const requested = (raw ?? DEFAULT_WRITE_ACTIONS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const known = new Set<string>(EXECUTABLE_ACTION_TYPES);
  return {
    requested: [...new Set(requested)],
    unknown: [...new Set(requested.filter((action) => !known.has(action)))],
  };
}

/** Union sorted allowlists so the tool never silently revokes an action. */
export function widenActions(current: readonly string[], requested: readonly string[]): string[] {
  return [...new Set([...current, ...requested])].sort();
}
