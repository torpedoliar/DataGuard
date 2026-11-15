/**
 * Pure, mock/local approval validation. Eligibility is NOT execution permission:
 * no persistence, queue, adapter selection, or read-only unlock lives here.
 * Current inputs must be rebuilt from trusted state at approval AND dispatch.
 */
import { z } from "zod";
import { EPDR_ACTION_TYPES } from "./action-types";

const id = z.number().int().positive().safe();
const revision = z.number().int().nonnegative().safe();
const label = z.string().min(1).refine((value) => value === value.trim());

const snapshotSchema = z.strictObject({
  target: z.strictObject({
    siteId: id,
    connectionId: id,
    region: label,
    accountId: label,
    endpointId: id,
    deviceId: label,
    // Explicit provenance, including null where not applicable. Never infer
    // ThreatSync entity IDs from endpoint inventory IDs.
    incidentId: id.nullable(),
    providerIncidentId: label.nullable(),
    entityId: label.nullable(),
  }),
  actionType: z.enum(EPDR_ACTION_TYPES),
  parameters: z.record(z.string(), z.json()),
  accountRevision: revision,
  credentialRevision: revision,
  ruleRevision: revision,
  evidenceGeneration: revision,
  requesterId: id.nullable(), // null denotes a system proposal
  expiresAt: z.number().int().nonnegative().safe(), // epoch milliseconds
});

export type ApprovalSnapshot = z.infer<typeof snapshotSchema>;

const contextSchema = z.strictObject({
  nowMs: z.number().int().nonnegative().safe(),
  maxValidityMs: z.number().int().positive().safe(),
  approverId: id,
  approverIsCurrentSiteAdmin: z.boolean(),
  requesterIsCurrentlyAuthorized: z.boolean(),
  // Recompute these from current security policy; approval never bypasses them.
  targetEligible: z.boolean(),
  actionAllowed: z.boolean(),
  capabilitySupported: z.boolean(),
  connectionEnabled: z.boolean(),
  dataFresh: z.boolean(),
  killSwitch: z.boolean(),
  hold: z.boolean(),
});

export type ApprovalContext = z.infer<typeof contextSchema>;
export type ApprovalValidation =
  | { eligible: true }
  | { eligible: false; reason: "invalid_input" | "snapshot_changed" | "self_approval" | "authorization" | "expired" | "ineligible" };

// JSON object order is immaterial, but array order, null, type, and every key
// (including scan exclusions/options) are material. No lossy JSON coercion.
function canonical(value: z.infer<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Validate only; never transitions an action or creates actionable approval. */
export function validateApprovalSnapshot(
  snapshot: unknown,
  current: unknown,
  context: unknown,
): ApprovalValidation {
  const frozen = snapshotSchema.safeParse(snapshot);
  const latest = snapshotSchema.safeParse(current);
  const checks = contextSchema.safeParse(context);
  if (!frozen.success || !latest.success || !checks.success) return { eligible: false, reason: "invalid_input" };
  const s = frozen.data;
  const c = checks.data;
  if (canonical(s) !== canonical(latest.data)) return { eligible: false, reason: "snapshot_changed" };
  if (s.requesterId === c.approverId) return { eligible: false, reason: "self_approval" };
  if (!c.approverIsCurrentSiteAdmin || !c.requesterIsCurrentlyAuthorized) return { eligible: false, reason: "authorization" };
  if (s.expiresAt <= c.nowMs || s.expiresAt - c.nowMs > c.maxValidityMs) return { eligible: false, reason: "expired" };
  if (!c.targetEligible || !c.actionAllowed || !c.capabilitySupported || !c.connectionEnabled || !c.dataFresh || c.killSwitch || c.hold) {
    return { eligible: false, reason: "ineligible" };
  }
  return { eligible: true };
}
