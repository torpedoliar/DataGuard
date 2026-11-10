/**
 * Detection exclusions (T08). Pure — no DB, no network. An active exclusion
 * keeps the detection visible with provenance; it suppresses automation and/or
 * new-incident creation, never existing Incident evidence.
 */

export type ExclusionInput = {
  matchMd5: string | null;
  matchThreatName: string | null;
  endpointId: number | null; // null = all endpoints of the site
  expiresAt: Date;
};

export function isExclusionActive(exclusion: { expiresAt: Date }, nowMs: number): boolean {
  return exclusion.expiresAt.getTime() > nowMs;
}

export function exclusionMatches(
  exclusion: ExclusionInput,
  detection: { md5: string | null; threatName: string | null; endpointId: number },
  nowMs: number,
): boolean {
  if (!isExclusionActive(exclusion, nowMs)) return false;
  if (exclusion.endpointId !== null && exclusion.endpointId !== detection.endpointId) return false;
  if (exclusion.matchMd5 && exclusion.matchMd5 === detection.md5) return true;
  if (exclusion.matchThreatName && exclusion.matchThreatName === detection.threatName) return true;
  return false;
}