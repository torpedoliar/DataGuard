import { planLocalResponse, type LocalResponseFlags } from "./local-response-policy";
import type { PlaybookSignal } from "./playbooks";

export type ResponseType = "scan" | "isolate";
/** Saved simulation config is consumed unchanged; binding alone chooses a supported recommendation. */
export function evaluateResponse(configuration: unknown, definition: unknown, response: ResponseType, signal: PlaybookSignal, flags: LocalResponseFlags, now: number) {
  const plan = planLocalResponse(configuration, definition, signal, flags, now);
  const reasons: string[] = [...plan.responsePolicy.reasons];
  if (plan.eligibility.status !== "matched") reasons.push(plan.eligibility.reason);
  if (response !== "scan" && response !== "isolate") reasons.push("unsupported_response");
  if (flags.noAuto === true) reasons.push("no_auto");
  if (response === "isolate" && flags.critical === true) reasons.push("critical_endpoint");
  return {
    schemaVersion: 1 as const,
    status: reasons.length ? "blocked" as const : "matched" as const,
    response,
    reasons: [...new Set(reasons)],
    eligibility: plan.eligibility,
    responsePolicy: plan.responsePolicy,
    providerLocked: true as const,
    operatorRequestRequired: true as const,
  };
}
