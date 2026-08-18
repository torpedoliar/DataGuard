export type ChecklistStatus = "OK" | "NOT OK";
export type IncidentSeverity = "Low" | "Medium" | "High" | "Critical";
export type IncidentStatus = "Open" | "In Progress" | "Resolved" | "Verified";
export type ResolutionCategory =
  | "Hardware"
  | "Power"
  | "Network"
  | "Environment"
  | "Human Error"
  | "False Alarm"
  | "Other";
export type ResolutionAction =
  | "Replaced"
  | "Reconfigured"
  | "Restarted"
  | "Cleaned"
  | "Escalated"
  | "No Action Needed";

export const incidentStatuses: IncidentStatus[] = ["Open", "In Progress", "Resolved", "Verified"];
export const incidentSeverities: IncidentSeverity[] = ["Low", "Medium", "High", "Critical"];
export const resolutionCategories: ResolutionCategory[] = [
  "Hardware",
  "Power",
  "Network",
  "Environment",
  "Human Error",
  "False Alarm",
  "Other",
];
export const resolutionActions: ResolutionAction[] = [
  "Replaced",
  "Reconfigured",
  "Restarted",
  "Cleaned",
  "Escalated",
  "No Action Needed",
];

export function getDefaultIncidentSeverity(status: ChecklistStatus): IncidentSeverity | null {
  if (status === "NOT OK") return "Medium";
  return null;
}

export function calculateIncidentDueDate(severity: IncidentSeverity, base = new Date()): Date {
  const due = new Date(base);
  if (severity === "Critical") {
    due.setHours(due.getHours() + 4);
    return due;
  }

  const daysBySeverity: Record<Exclude<IncidentSeverity, "Critical">, number> = {
    Low: 7,
    Medium: 3,
    High: 1,
  };
  due.setDate(due.getDate() + daysBySeverity[severity]);
  return due;
}

export function canTransitionIncidentStatus(input: {
  isAdmin: boolean;
  isAssignee: boolean;
  current: IncidentStatus;
  next: IncidentStatus;
  /**
   * Whether resolution category/action data is staged (or already on record)
   * for this transition. Resolved and Verified are resolution states — an
   * admin fast-path may verify straight from Open/In Progress, but never
   * without resolution data (finding #24). Leave undefined when the caller
   * only asks about the status matrix (allowedNextStatuses); the action
   * enforces the data gate with the real value.
   */
  resolutionProvided?: boolean;
}): boolean {
  // Same-status transitions are intentionally rejected: a no-op status change
  // would surface as a meaningless "move to the current status" button and
  // append a redundant incidentUpdates row. Terminal states simply have no
  // allowed next status.
  if (!input.resolutionProvided && (input.next === "Resolved" || input.next === "Verified")) {
    return false;
  }

  if (input.isAdmin) {
    if (input.current === "Verified") return input.next === "Open";
    return true;
  }

  if (!input.isAssignee) return false;

  const staffTransitions: Record<IncidentStatus, IncidentStatus[]> = {
    Open: ["In Progress"],
    "In Progress": ["Resolved"],
    Resolved: [],
    Verified: [],
  };
  return staffTransitions[input.current].includes(input.next);
}

/**
 * Pure: returns the list of allowed next statuses for the given role.
 * Does NOT require DB.
 */
export function allowedNextStatuses(input: {
  isAdmin: boolean;
  isAssignee: boolean;
  current: IncidentStatus;
}): IncidentStatus[] {
  return incidentStatuses.filter((next) =>
    // The list cannot know whether resolution data exists; the action enforces
    // the resolution gate with the real value (finding #24).
    canTransitionIncidentStatus({ ...input, next, resolutionProvided: true }),
  );
}

export function isRecurringIncident(recentDeviceIncidentCount: number): boolean {
  return recentDeviceIncidentCount >= 2;
}
