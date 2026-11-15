import { EPDR_ACTION_TYPES, type EpdrActionType } from "./action-types";

export type ProviderCapability = {
  action: EpdrActionType | "provider_status" | "provider_comment" | "repair";
  execution: "blocked_read_only" | "unsupported";
  proposedMode: "restricted_scan" | "approval" | "manual";
  requiresCapabilityReview: boolean;
};

/** Design inventory, not an execution permission or proof of provider support. */
export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  ...EPDR_ACTION_TYPES.map((action): ProviderCapability => ({
    action,
    execution: "blocked_read_only",
    proposedMode: action === "scan" ? "restricted_scan" : "approval",
    requiresCapabilityReview: true,
  })),
  { action: "provider_status", execution: "blocked_read_only", proposedMode: "approval", requiresCapabilityReview: true },
  { action: "provider_comment", execution: "blocked_read_only", proposedMode: "approval", requiresCapabilityReview: true },
  { action: "repair", execution: "unsupported", proposedMode: "manual", requiresCapabilityReview: true },
];

/** No persisted setting, approval or requested mode can grant dispatch here. */
export function providerExecutionDecision(action: string): "blocked_read_only" | "unsupported" {
  return PROVIDER_CAPABILITIES.find((capability) => capability.action === action)?.execution ?? "unsupported";
}
