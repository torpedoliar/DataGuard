/**
 * Capability contract for the EPDR local review surface.
 *
 * This is the single vocabulary both the domain layer and the UI use for what
 * a local review can and cannot do. It is derived from what the engine and the
 * response policy already guarantee — `local-playbook-engine.ts` suppresses
 * provider/notify steps with exactly these reasons, and
 * `local-response-policy.ts` always returns the locked flags — so this module
 * invents no second source of truth and imports nothing.
 *
 * Run-status vocabulary (pinned for the UI copy added in T03/T04):
 * - `pending`  — the run exists, no operator has driven it yet;
 * - `running`  — an OPERATOR CLAIM that they are driving the review now; it
 *                never implies any provider or automation activity;
 * - `finished` — local evidence recording is complete; it is not remediation
 *                and not a delivery receipt.
 */

export type LocalCapabilityAvailability = "available" | "suppressed" | "disabled" | "required";
export type LocalCapabilityReason =
  | "provider_execution_disabled"
  | "notifications_disabled"
  | "use_explicit_local_incident_handoff";

export const LOCAL_REVIEW_CAPABILITIES = {
  localEvidence: "available",
  analystReview: "available",
  incidentHandoff: "available",
  localDecision: "available",
  providerAction: { availability: "suppressed", reason: "provider_execution_disabled" },
  notification: { availability: "disabled", reason: "notifications_disabled" },
  automationDelivered: false,
} as const satisfies LocalReviewCapabilities;

export type LocalReviewCapabilities = {
  /** Immutable detection evidence is recorded locally. */
  localEvidence: "available";
  /** An administrator reviews the recorded evidence. */
  analystReview: "available";
  /** An explicit handoff can create/link a DC Incident. */
  incidentHandoff: "available";
  /** Local decisions (digest proposal, correlation, PIC review) are recorded. */
  localDecision: "available";
  /** No provider command exists in this surface, ever. */
  providerAction: { availability: "suppressed"; reason: "provider_execution_disabled" };
  /** Local notification delivery is not wired in this surface. */
  notification: { availability: "disabled"; reason: "notifications_disabled" };
  /** Nothing is delivered by automation, ever. */
  automationDelivered: false;
};

/**
 * Per-step capability label. `record`, `review`, `incident` and `handoff` steps
 * are NOT inert: they record evidence or require an explicit operator action.
 * Template actions `scan`/`isolate` run as provider steps; both are suppressed
 * by design.
 */
export function localStepCapability(
  kind: "record" | "review" | "incident" | "handoff" | "notify" | "provider" | "scan" | "isolate",
): { availability: LocalCapabilityAvailability; reason: LocalCapabilityReason | null } {
  switch (kind) {
    case "record":
    case "review":
    case "incident":
    case "handoff":
      return { availability: "available", reason: null };
    case "notify":
      return { availability: "disabled", reason: "notifications_disabled" };
    case "provider":
    case "scan":
    case "isolate":
      return { availability: "suppressed", reason: "provider_execution_disabled" };
  }
}
