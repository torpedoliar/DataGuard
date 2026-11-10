import { describe, expect, it } from "vitest";
import {
  isScoredIncident,
  normalizeCategoryFromExport,
  normalizeThreatSyncCategory,
  severityFromScore,
  sourceKeyForEventExport,
  sourceKeyForThreatSync,
} from "./detections";

describe("normalizeCategoryFromExport", () => {
  it("maps the documented export types", () => {
    expect(normalizeCategoryFromExport(1)).toBe("malware");
    expect(normalizeCategoryFromExport(2)).toBe("pup");
    expect(normalizeCategoryFromExport(4)).toBe("exploit");
    expect(normalizeCategoryFromExport(6)).toBe("virus");
    expect(normalizeCategoryFromExport(18)).toBe("ioa");
    expect(normalizeCategoryFromExport(999)).toBe("other");
  });
});

describe("normalizeThreatSyncCategory", () => {
  it("lowercases known categories and keeps av as other without explicit evidence", () => {
    expect(normalizeThreatSyncCategory("Malware")).toBe("malware");
    expect(normalizeThreatSyncCategory("PUP")).toBe("pup");
    expect(normalizeThreatSyncCategory("AV")).toBe("other");
    expect(normalizeThreatSyncCategory("AV", "virus")).toBe("virus");
    expect(normalizeThreatSyncCategory("AV", "PUP.registry")).toBe("pup");
    expect(normalizeThreatSyncCategory("something-else")).toBe("other");
  });
});

describe("severityFromScore / isScoredIncident", () => {
  it("maps score to severity", () => {
    expect(severityFromScore(null)).toBeNull();
    expect(severityFromScore(9)).toBe("Critical");
    expect(severityFromScore(10)).toBe("Critical");
    expect(severityFromScore(7)).toBe("High");
    expect(severityFromScore(5)).toBe("Medium");
    expect(severityFromScore(2)).toBe("Low");
  });

  it("requires 7 <= score <= 10 and a declared category", () => {
    const cats = ["malware", "pup", "virus", "exploit", "ioa"];
    expect(isScoredIncident("malware", 9, cats)).toBe(true);
    expect(isScoredIncident("malware", 6, cats)).toBe(false);
    expect(isScoredIncident("malware", 11, cats)).toBe(false);
    expect(isScoredIncident("malware", null, cats)).toBe(false);
    expect(isScoredIncident("other", 9, cats)).toBe(false);
  });
});

describe("source keys", () => {
  it("scopes event export by provider event id when present", () => {
    expect(sourceKeyForEventExport({ providerEventId: "e-1", type: 1, deviceId: "d", detectedAt: "t" })).toBe("evt:e-1");
  });

  it("falls back to a stable canonical fingerprint without an id", () => {
    const a = sourceKeyForEventExport({ type: 1, deviceId: "d-1", detectedAt: "2026-01-01T00:00:00Z", threatName: "x", md5: "m" });
    const b = sourceKeyForEventExport({ type: 1, deviceId: "d-1", detectedAt: "2026-01-01T00:00:00Z", threatName: "x", md5: "m" });
    const c = sourceKeyForEventExport({ type: 2, deviceId: "d-1", detectedAt: "2026-01-01T00:00:00Z", threatName: "x", md5: "m" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("scopes ThreatSync by incident + entity", () => {
    expect(sourceKeyForThreatSync("ts-1", "e-1")).toBe("ts:ts-1:e-1");
  });
});