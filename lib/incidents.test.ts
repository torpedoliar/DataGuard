import { describe, expect, it } from "vitest";
import {
  allowedNextStatuses,
  canTransitionIncidentStatus,
  calculateIncidentDueDate,
  getDefaultIncidentSeverity,
  isRecurringIncident,
} from "./incidents";

describe("incident domain rules", () => {
  it("maps checklist statuses to default incident severity", () => {
    expect(getDefaultIncidentSeverity("OK")).toBeNull();
    expect(getDefaultIncidentSeverity("Warning")).toBe("Medium");
    expect(getDefaultIncidentSeverity("Error")).toBe("High");
  });

  it("calculates SLA due dates by severity", () => {
    const base = new Date("2026-05-19T00:00:00.000Z");

    expect(calculateIncidentDueDate("Low", base).toISOString()).toBe("2026-05-26T00:00:00.000Z");
    expect(calculateIncidentDueDate("Medium", base).toISOString()).toBe("2026-05-22T00:00:00.000Z");
    expect(calculateIncidentDueDate("High", base).toISOString()).toBe("2026-05-20T00:00:00.000Z");
    expect(calculateIncidentDueDate("Critical", base).toISOString()).toBe("2026-05-19T04:00:00.000Z");
  });

  it("limits status transitions by role and assignment", () => {
    expect(canTransitionIncidentStatus({ isAdmin: false, isAssignee: true, current: "Open", next: "In Progress" })).toBe(true);
    expect(canTransitionIncidentStatus({ isAdmin: false, isAssignee: true, current: "In Progress", next: "Resolved" })).toBe(true);
    expect(canTransitionIncidentStatus({ isAdmin: false, isAssignee: true, current: "Resolved", next: "Verified" })).toBe(false);
    expect(canTransitionIncidentStatus({ isAdmin: true, isAssignee: false, current: "Resolved", next: "Verified" })).toBe(true);
    expect(canTransitionIncidentStatus({ isAdmin: true, isAssignee: false, current: "Verified", next: "Open" })).toBe(true);
  });

  it("flags recurring device incidents after multiple recent incidents", () => {
    expect(isRecurringIncident(0)).toBe(false);
    expect(isRecurringIncident(1)).toBe(false);
    expect(isRecurringIncident(2)).toBe(true);
  });
});

describe("allowedNextStatuses", () => {
  it("returns every status to admins from Open", () => {
    expect(allowedNextStatuses({ isAdmin: true, isAssignee: false, current: "Open" }))
      .toEqual(["Open", "In Progress", "Resolved", "Verified"]);
  });

  it("returns only In Progress for staff assignees from Open", () => {
    expect(allowedNextStatuses({ isAdmin: false, isAssignee: true, current: "Open" }))
      .toEqual(["In Progress"]);
  });

  it("returns only the current status to staff assignees from Resolved (terminal for staff)", () => {
    expect(allowedNextStatuses({ isAdmin: false, isAssignee: true, current: "Resolved" }))
      .toEqual(["Resolved"]);
  });

  it("returns Open and Verified to admins from Verified (re-open allowed)", () => {
    expect(allowedNextStatuses({ isAdmin: true, isAssignee: false, current: "Verified" }))
      .toEqual(["Open", "Verified"]);
  });
});
