export type ChecklistStatus = "OK" | "Warning" | "Error";
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
  if (status === "Warning") return "Medium";
  if (status === "Error") return "High";
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
}): boolean {
  if (input.current === input.next) return true;

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

export function isRecurringIncident(recentDeviceIncidentCount: number): boolean {
  return recentDeviceIncidentCount >= 2;
}
