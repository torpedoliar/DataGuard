import { describe, expect, it } from "vitest";
import { breakerShouldTrip } from "./breaker";
import { exclusionMatches } from "./exclusions";

describe("breakerShouldTrip", () => {
  it("trips on count or same-threat endpoints", () => {
    expect(breakerShouldTrip({ actionsInWindow: 21, maxActions: 20, sameThreatEndpoints: 1, sameThreatMax: 5 })).toBe(true);
    expect(breakerShouldTrip({ actionsInWindow: 5, maxActions: 20, sameThreatEndpoints: 5, sameThreatMax: 5 })).toBe(true);
    expect(breakerShouldTrip({ actionsInWindow: 10, maxActions: 20, sameThreatEndpoints: 4, sameThreatMax: 5 })).toBe(false);
  });
});

describe("exclusionMatches", () => {
  const now = 1_000_000;
  const future = new Date(now + 60_000);
  const past = new Date(now - 1);

  it("matches active md5/name for the endpoint or whole site", () => {
    expect(exclusionMatches({ matchMd5: "m", matchThreatName: null, endpointId: 5, expiresAt: future }, { md5: "m", threatName: "x", endpointId: 5 }, now)).toBe(true);
    expect(exclusionMatches({ matchMd5: null, matchThreatName: "x", endpointId: null, expiresAt: future }, { md5: "y", threatName: "x", endpointId: 9 }, now)).toBe(true);
  });

  it("does not match a different endpoint, key, or an expired exclusion", () => {
    expect(exclusionMatches({ matchMd5: "m", matchThreatName: null, endpointId: 5, expiresAt: future }, { md5: "m", threatName: null, endpointId: 6 }, now)).toBe(false);
    expect(exclusionMatches({ matchMd5: "m", matchThreatName: null, endpointId: null, expiresAt: past }, { md5: "m", threatName: null, endpointId: 5 }, now)).toBe(false);
  });
});