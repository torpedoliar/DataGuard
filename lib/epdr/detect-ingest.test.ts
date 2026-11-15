import { describe, expect, it } from "vitest";
import { threatSyncIncidentSchema } from "../watchguard/schemas";
import {
  buildSecurityEventDetections,
  buildThreatSyncDetections,
  classifyThreatSync,
  dedupeDetections,
  md5ThreatKeySuffix,
  type IngestSettings,
} from "./detect-ingest";

const settings: IngestSettings = {
  eventTypes: [1, 2, 4, 6, 18],
  threatsyncCategories: ["malware", "pup", "virus", "exploit", "ioa"],
  threatsyncMinScore: 7,
  threatsyncMaxScore: 10,
  defaultSeverity: { "1": "High", "2": "Medium", "4": "High", "6": "High", "18": "High" },
  correlationWindowMinutes: 1440,
  reopenWindowDays: 7,
  defaultAssigneeId: null,
};

describe("md5ThreatKeySuffix", () => {
  it.each([
    ["d41d8cd98f00b204e9800998ecf8427e", "%:d41d8cd98f00b204e9800998ecf8427e"],
    ["D41D8CD98F00B204E9800998ECF8427E", "%:D41D8CD98F00B204E9800998ECF8427E"],
  ])("accepts a full 32-hex hash %s", (md5, expected) => expect(md5ThreatKeySuffix(md5)).toBe(expected));
  it.each([null, undefined, "", "md5-a", "zzzz8cd98f00b204e9800998ecf8427e", "d41d8cd98f00b204e9800998ecf8427e00", "%_d41d8cd98f00b204e9800998ecf8427e"])(
    "rejects a non-hash value %j so LIKE wildcards cannot be injected", (md5) => expect(md5ThreatKeySuffix(md5)).toBeNull());
});

describe("classifyThreatSync", () => {
  it("accepts in-scope categories with a score 7-10 and rejects the rest", () => {
    expect(classifyThreatSync("malware", 9, settings)).toEqual({ accepted: true });
    expect(classifyThreatSync("malware", 6, settings).accepted).toBe(false);
    expect(classifyThreatSync("malware", 11, settings).accepted).toBe(false);
    expect(classifyThreatSync("other", 9, settings).accepted).toBe(false);
  });
});

describe("buildThreatSyncDetections", () => {
  it("retains documented camelCase score through wire normalization", () => {
    const incident = threatSyncIncidentSchema.parse({
      id: "synthetic-ts", category: "malware", threatScore: 9,
      entities: { "synthetic-entity": { type: "computer", recommendedActions: [] } },
    });
    const result = buildThreatSyncDetections(incident, settings);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]?.threatScore).toBe(9);
    expect(result.detections[0]?.sourceKey).toBe("ts:synthetic-ts:synthetic-entity");
    expect(result.unmatched).toEqual([]);
  });
  it("builds one detection per entity and keeps unmatched/below-threshold separate", () => {
    const result = buildThreatSyncDetections({
      id: "ts-1",
      category: "malware",
      type: "ransomware",
      threat_score: 9,
      entities: [
        { entityId: "e-1", md5: "md5-a" },
        { entityId: "e-2" },
      ],
    }, settings);

    expect(result.detections).toHaveLength(2);
    expect(result.detections[0]!.sourceKey).toBe("ts:ts-1:e-1");
    expect(result.detections[0]!.category).toBe("malware");
    expect(result.detections[0]!.severity).toBe("Critical");
    expect(result.unmatched).toHaveLength(0);
  });

  it("marks below-threshold or missing-entity entities as unmatched", () => {
    const result = buildThreatSyncDetections({
      id: "ts-2",
      category: "ioa",
      threat_score: 3,
      entities: [{ entityId: "e-1" }, {}],
    }, settings);
    expect(result.detections).toHaveLength(0);
    expect(result.unmatched).toHaveLength(2);
    expect(result.unmatched[0]!.reason).toBe("score_out_of_range");
    expect(result.unmatched[1]!.reason).toBe("missing_entity_id");
  });
});

describe("buildSecurityEventDetections", () => {
  it("accepts in-scope event types without a required score", () => {
    const result = buildSecurityEventDetections([
      { event_type: 1, device_id: "d-1", detected_at: "2026-01-01T00:00:00Z", threat_name: "T", md5: "m" },
    ], settings);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]!.category).toBe("malware");
    expect(result.detections[0]!.threatScore).toBeNull();
  });

  it("ignores out-of-scope types and unmatched (missing device) events", () => {
    const result = buildSecurityEventDetections([
      { event_type: 99, device_id: "d-1" },
      { event_type: 2 },
    ], settings);
    expect(result.detections).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
    expect(result.unmatched).toHaveLength(1);
  });
});

describe("dedupeDetections", () => {
  it("keeps only detections whose source key is new", () => {
    const detections = buildSecurityEventDetections([
      { event_type: 1, device_id: "d-1", detected_at: "t", threat_name: "T", md5: "m", provider_event_id: "p-1" },
      { event_type: 2, device_id: "d-1", detected_at: "t", threat_name: "T2", md5: "m2", provider_event_id: "p-2" },
    ], settings).detections;
    const kept = dedupeDetections(detections, new Set([detections[0]!.sourceKey]));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.sourceKey).toBe(detections[1]!.sourceKey);
  });
});