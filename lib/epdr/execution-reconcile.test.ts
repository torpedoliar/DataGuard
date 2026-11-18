import { describe, expect, it } from "vitest";
import {
  interpretIncidentStatusMatch,

  interpretObservation,
  interpretThreatSyncStatus,
  isIsolationVerified,
  reconcileUnknownOutcome,
} from "./execution-reconcile";

describe("reconciliation of an unknown outcome", () => {
  it("never declares failure when nothing was found yet", () => {
    expect(
      reconcileUnknownOutcome({ exactMatches: 0, markerReadable: true, candidateStatuses: [] }),
    ).toEqual({ kind: "not_found_yet" });
  });

  it("adopts exactly one match", () => {
    expect(
      reconcileUnknownOutcome({ exactMatches: 1, markerReadable: true, candidateStatuses: ["pending"] }),
    ).toEqual({ kind: "adopt_in_progress", providerRef: null });
    expect(
      reconcileUnknownOutcome({ exactMatches: 1, markerReadable: true, candidateStatuses: ["succeeded"] }),
    ).toEqual({ kind: "adopt_completed", resultsComplete: false });
  });

  it("sends multiple or unreadable matches to review instead of choosing", () => {
    expect(
      reconcileUnknownOutcome({ exactMatches: 2, markerReadable: true, candidateStatuses: ["pending", "pending"] }),
    ).toEqual({ kind: "needs_review", reason: "ambiguous_match" });
    expect(
      reconcileUnknownOutcome({ exactMatches: 1, markerReadable: false, candidateStatuses: ["pending"] }),
    ).toEqual({ kind: "needs_review", reason: "marker_unreadable" });
    expect(
      reconcileUnknownOutcome({ exactMatches: 1, markerReadable: true, candidateStatuses: ["unknown"] }),
    ).toEqual({ kind: "needs_review", reason: "conflicting_status" });
  });
});

describe("observation interpretation", () => {
  it("keeps pending work running until the deadline", () => {
    expect(interpretObservation({ rawStatus: 0, resultsComplete: false, deadlineMs: 2_000, nowMs: 1_000 })).toEqual({
      kind: "still_running",
    });
    expect(interpretObservation({ rawStatus: 0, resultsComplete: false, deadlineMs: 2_000, nowMs: 2_000 })).toEqual({
      kind: "deadline_exceeded",
    });
  });

  it("reports completion with the real result-completeness flag", () => {
    expect(interpretObservation({ rawStatus: 2, resultsComplete: false, deadlineMs: 2_000, nowMs: 1_000 })).toEqual({
      kind: "finished",
      outcome: "completed",
      resultsComplete: false,
    });
  });

  it("never treats an unreadable status as success", () => {
    expect(interpretObservation({ rawStatus: 99, resultsComplete: true, deadlineMs: 2_000, nowMs: 1_000 })).toEqual({
      kind: "unreadable",
    });
    expect(interpretObservation({ rawStatus: null, resultsComplete: true, deadlineMs: 2_000, nowMs: 1_000 })).toEqual({
      kind: "unreadable",
    });
  });
});

describe("ThreatSync status interpretation", () => {
  it("maps only the documented example values and leaves the rest unreadable", () => {
    expect(interpretThreatSyncStatus("inProgress")).toEqual({ kind: "still_running" });
    expect(interpretThreatSyncStatus("performed")).toEqual({ kind: "finished", outcome: "completed" });
    // The full status enum is not published, so an unlisted value is not a failure.
    expect(interpretThreatSyncStatus("failed")).toEqual({ kind: "unreadable" });
    expect(interpretThreatSyncStatus("teleported")).toEqual({ kind: "unreadable" });
    expect(interpretThreatSyncStatus(null)).toEqual({ kind: "unreadable" });
  });
});

describe("ThreatSync incident status matching", () => {
  it("completes only on an exact requested-status match", () => {
    expect(interpretIncidentStatusMatch("closed", "closed")).toEqual({ kind: "finished", outcome: "completed" });
    expect(interpretIncidentStatusMatch("Closed", " CLOSED ")).toEqual({ kind: "finished", outcome: "completed" });
    // A different provider status is eventual consistency, not completion.
    expect(interpretIncidentStatusMatch("closed", "new")).toEqual({ kind: "still_running" });
    // A missing requested or reported status is unreadable, never a guess.
    expect(interpretIncidentStatusMatch(null, "closed")).toEqual({ kind: "unreadable" });
    expect(interpretIncidentStatusMatch("closed", null)).toEqual({ kind: "unreadable" });
    expect(interpretIncidentStatusMatch("  ", "closed")).toEqual({ kind: "unreadable" });
  });
});

describe("isolation verification", () => {
  it("requires the endpoint state to match the requested direction", () => {
    expect(isIsolationVerified({ actionType: "isolate", isolationState: 1 })).toBe(true);
    expect(isIsolationVerified({ actionType: "isolate", isolationState: 0 })).toBe(false);
    expect(isIsolationVerified({ actionType: "unisolate", isolationState: 0 })).toBe(true);
    expect(isIsolationVerified({ actionType: "unisolate", isolationState: null })).toBe(false);
  });

  it("never treats an unrecognized state as released", () => {
    expect(isIsolationVerified({ actionType: "unisolate", isolationState: "isolating" })).toBe(false);
    expect(isIsolationVerified({ actionType: "unisolate", isolationState: 2 })).toBe(false);
  });
});
