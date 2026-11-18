/**
 * Provider capability inventory.
 *
 * This is the bridge between the wider action-type vocabulary and the verified
 * write registry. Only operations present in `WRITE_OPERATIONS` are ever
 * dispatchable, and only when the runtime enablement, per-site allowlist,
 * approvals and kill switches all agree (see `execution-policy.ts`).
 *
 * An entry here is a *capability statement*, never an execution permission:
 * `providerExecutionDecision` answers "is this operation backed by a verified
 * contract?", not "may this request be sent?".
 */
import { EPDR_ACTION_TYPES, type EpdrActionType } from "./action-types";
import { isWriteActionType, unsupportedActionReason, type WriteActionType } from "./execution-capability";

export type ProviderExecutionStatus = "verified_write" | "unsupported";

export type ProviderCapability = {
  action: EpdrActionType | "provider_status" | "provider_comment" | "repair";
  execution: ProviderExecutionStatus;
  /** Reason recorded when the operation cannot be dispatched. */
  unsupportedReason: string | null;
  requiresCapabilityReview: boolean;
};

export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  ...EPDR_ACTION_TYPES.map((action): ProviderCapability => {
    const verified = isWriteActionType(action);
    return {
      action,
      execution: verified ? "verified_write" : "unsupported",
      unsupportedReason: verified ? null : unsupportedActionReason(action),
      // A verified contract is still re-reviewed before it is enabled for a site.
      requiresCapabilityReview: true,
    };
  }),
  { action: "provider_status", execution: "verified_write", unsupportedReason: null, requiresCapabilityReview: true },
  { action: "provider_comment", execution: "unsupported", unsupportedReason: "No documented standalone comment create operation.", requiresCapabilityReview: true },
  { action: "repair", execution: "unsupported", unsupportedReason: "No documented provider contract.", requiresCapabilityReview: true },
];

/**
 * Contract-level decision only. A `verified_write` result means the operation
 * has a documented provider contract; it never authorizes a dispatch by itself.
 */
export function providerExecutionDecision(action: string): ProviderExecutionStatus {
  return PROVIDER_CAPABILITIES.find((capability) => capability.action === action)?.execution ?? "unsupported";
}

/** Actions that can be offered in an execution request form. */
export const EXECUTABLE_ACTION_TYPES: readonly WriteActionType[] =
  EPDR_ACTION_TYPES.filter(isWriteActionType);
