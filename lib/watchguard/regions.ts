/**
 * WatchGuard Cloud region hosts.
 *
 * Every WatchGuard API call in this project must resolve to exactly one of
 * these fixed HTTPS hosts. The transport guard (see `guard.ts`) rejects any
 * other host, protocol, port, userinfo, fragment or redirect. This is the only
 * source of allowed hosts — no code path may construct a provider URL from a
 * free-form string.
 */

export const WATCHGUARD_REGIONS = {
  jpn: "api.jpn.cloud.watchguard.com",
  deu: "api.deu.cloud.watchguard.com",
  usa: "api.usa.cloud.watchguard.com",
} as const;

export type WatchGuardRegion = keyof typeof WATCHGUARD_REGIONS;

export function regionHost(region: WatchGuardRegion): string {
  return WATCHGUARD_REGIONS[region];
}

export function isWatchGuardRegion(value: unknown): value is WatchGuardRegion {
  return typeof value === "string" && value in WATCHGUARD_REGIONS;
}