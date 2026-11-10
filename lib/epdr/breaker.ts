/**
 * Circuit breaker (T08). Pure — no DB, no network.
 */

export type BreakerInput = {
  actionsInWindow: number;
  maxActions: number;
  sameThreatEndpoints: number;
  sameThreatMax: number;
};

export function breakerShouldTrip(input: BreakerInput): boolean {
  return input.actionsInWindow > input.maxActions || input.sameThreatEndpoints >= input.sameThreatMax;
}