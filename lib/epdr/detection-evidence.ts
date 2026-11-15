/** Read completeness is not provider capability verification. No DB or network. */
export const REQUIRED_EVENT_EXPORT_TYPES = [1, 2, 4, 6, 18] as const;
export type DetectionEvidenceSource = "threatsync" | "event_export";
/** Documentation-supported READ operations only; not write support, entitlement,
 * provider availability, target identity, or proof of exhaustive historical coverage.
 * Proof: repository T01-api-client.md lines 29–41 and guard.ts exact GET routes.
 */
export const DETECTION_SOURCE_READ_CAPABILITIES = {
  event_export: {
    status: "documented", method: "GET",
    route: "/rest/endpoint-security/management/api/v1/accounts/{accountId}/securityevents/{type}/export/{period}",
    proof: "docs/superpowers/plans/2026-11-09-watchguard-epdr/T01-api-client.md#client-methods",
    window: "event_export_period_1",
  },
  threatsync: {
    status: "documented", method: "GET",
    route: "/rest/threatsync/management/v1/{accountId}/incidents",
    proof: "docs/superpowers/plans/2026-11-09-watchguard-epdr/T01-api-client.md#client-methods",
    window: "provider_default",
  },
} as const;
export function detectionSourceReadSupported(source: string): boolean {
  return Object.hasOwn(DETECTION_SOURCE_READ_CAPABILITIES, source);
}
export type DetectionReadEvidence = {
  connectionId: number;
  accountRevision: number;
  credentialRevision: number;
  source: string;
  /** Null means the site settings row did not exist at read start. */
  settingsUpdatedAt: Date | null;
  status: string;
  /** Actual request scope; not a claim about historical detection-time coverage. */
  window: string;
  startedAt: Date;
  finishedAt: Date;
  eventTypes: number[];
  completedEventTypes: number[];
};

export function eventExportReadStatus(requested: readonly number[], completed: readonly number[]): "completed" | "partial" | "failed" {
  if (completed.length === 0) return requested.length === 0 ? "partial" : "failed";
  return REQUIRED_EVENT_EXPORT_TYPES.every((type) => requested.includes(type) && completed.includes(type)) &&
    requested.every((type) => completed.includes(type)) ? "completed" : "partial";
}

/**
 * Pass the LATEST attempt for this source (including failed/partial attempts), not
 * the latest successful one. Fetch in the caller's local mutation transaction and
 * lock the current connection and site settings there. Documented READ support is
 * resolved from the registry; neither successful reads nor connection health prove it.
 */
export function detectionCompleteness(evidence: DetectionReadEvidence | null | undefined, context: {
  connectionId: number;
  accountRevision: number;
  credentialRevision: number;
  source: DetectionEvidenceSource;
  enabled: boolean;
  settingsUpdatedAt: Date | null;
  /** Optional extra veto, never a substitute for the documented registry. */
  supportVerified?: boolean;
  now: number;
  maxAgeMs: number;
}): { completeness: { source: DetectionEvidenceSource; status: "verified" | "partial" | "unknown" }; syncedAt: number | null } {
  const unknown = { completeness: { source: context.source, status: "unknown" as const }, syncedAt: null };
  if (!context.enabled || context.supportVerified === false || !detectionSourceReadSupported(context.source) || !evidence || evidence.source !== context.source ||
      evidence.connectionId !== context.connectionId || evidence.accountRevision !== context.accountRevision ||
      evidence.credentialRevision !== context.credentialRevision) return unknown;
  if ((evidence.settingsUpdatedAt?.getTime() ?? null) !== (context.settingsUpdatedAt?.getTime() ?? null)) return unknown;
  const start = evidence.startedAt.getTime();
  const finish = evidence.finishedAt.getTime();
  const expectedWindow = context.source === "event_export" ? "event_export_period_1" : "provider_default";
  if (!Number.isFinite(context.now) || !Number.isFinite(context.maxAgeMs) || context.maxAgeMs <= 0 ||
      !Number.isFinite(start) || !Number.isFinite(finish) || finish < start || finish > context.now ||
      context.now - start > context.maxAgeMs || evidence.window !== expectedWindow) return unknown;
  const completed = evidence.status === "completed" && (context.source !== "event_export" ||
    eventExportReadStatus(evidence.eventTypes, evidence.completedEventTypes) === "completed");
  return { completeness: { source: context.source, status: completed ? "verified" : "partial" }, syncedAt: completed ? finish : null };
}
