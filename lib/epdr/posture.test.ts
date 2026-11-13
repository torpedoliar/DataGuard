import { describe, expect, it } from "vitest";
import {
  bucketForEndpoint,
  buildThreatTrend,
  isOffline,
  resolveConnectionState,
  summarizeFleet,
  type PostureEndpoint,
} from "./posture";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

describe("resolveConnectionState", () => {
  const base = { configured: true, enabled: true, lastSyncAt: new Date(NOW - 60_000), lastSyncError: null, syncIntervalMinutes: 15, nowMs: NOW };

  it("walks the lifecycle from not configured to live", () => {
    expect(resolveConnectionState({ ...base, configured: false })).toBe("not_configured");
    expect(resolveConnectionState({ ...base, enabled: false })).toBe("disabled");
    expect(resolveConnectionState({ ...base, lastSyncAt: null })).toBe("syncing_first");
    expect(resolveConnectionState(base)).toBe("live");
  });

  it("flags stale data and never treats partial or failed first fetches as live", () => {
    expect(resolveConnectionState({ ...base, lastSyncAt: new Date(NOW - 46 * 60_000) })).toBe("stale");
    expect(resolveConnectionState({ ...base, lastSyncError: "WatchGuard API responded 401" })).toBe("error");
    expect(resolveConnectionState({ ...base, lastSyncError: "partial fetch" })).toBe("error");
    expect(resolveConnectionState({ ...base, lastSyncAt: null, lastSyncError: "auth" })).toBe("error");
  });
});

describe("bucketForEndpoint", () => {
  it("maps protection status and treats unknown enums as unknown", () => {
    const b = (s: number | null, eng = 0, kc = 0) => bucketForEndpoint({ accumulatedProtectionStatus: s, protectionEngineUpdateStatus: eng, knowledgeCatalogUpdateStatus: kc });
    expect(b(1)).toBe("protected");
    expect(b(1, 1)).toBe("outdated");
    expect(b(2)).toBe("disabled");
    expect(b(3)).toBe("error");
    expect(b(4)).toBe("install_error");
    expect(b(5)).toBe("no_license");
    expect(b(99)).toBe("unknown");
    expect(b(null)).toBe("unknown");
  });
});

describe("isOffline", () => {
  it("is offline only beyond three days and never for an unknown last contact", () => {
    expect(isOffline(new Date(NOW - 4 * 86_400_000), NOW)).toBe(true);
    expect(isOffline(new Date(NOW - 2 * 86_400_000), NOW)).toBe(false);
    expect(isOffline(null, NOW)).toBe(false);
  });
});

describe("summarizeFleet", () => {
  const ep = (id: number, bucket: PostureEndpoint["bucket"], extra: Partial<PostureEndpoint> = {}): PostureEndpoint => ({
    id, hostName: `H${id}`, deviceType: 1, isCritical: false, bucket, offline: false, lastConnectionAt: new Date(NOW), ...extra,
  });

  it("counts buckets, computes protected share and returns null for an empty fleet", () => {
    const s = summarizeFleet([ep(1, "protected"), ep(2, "protected"), ep(3, "outdated"), ep(4, "error")]);
    expect(s.total).toBe(4);
    expect(s.counts.error).toBe(1);
    expect(s.protectedPct).toBe(75);
    expect(summarizeFleet([]).protectedPct).toBeNull();
  });

  it("orders attention by severity, then servers/critical, then longest silent", () => {
    const s = summarizeFleet([
      ep(1, "error"),
      ep(2, "disabled"),
      ep(3, "error", { deviceType: 3 }),
      ep(4, "protected"),
      ep(5, "error", { lastConnectionAt: new Date(NOW - 86_400_000) }),
    ]);
    expect(s.attention.map((e) => e.id)).toEqual([2, 3, 5, 1]);
  });
});

describe("buildThreatTrend", () => {
  it("zero-fills the window, buckets by UTC day and drops other categories", () => {
    const trend = buildThreatTrend(
      [
        { category: "malware", detectedAt: new Date(NOW) },
        { category: "malware", detectedAt: new Date(NOW - 3_600_000) },
        { category: "pup", detectedAt: new Date(NOW - 2 * 86_400_000) },
        { category: "other", detectedAt: new Date(NOW) },
        { category: "malware", detectedAt: new Date(NOW - 40 * 86_400_000) },
      ],
      NOW,
      30,
    );
    expect(trend).toHaveLength(30);
    expect(trend[29]!.counts.malware).toBe(2);
    expect(trend[29]!.total).toBe(2);
    expect(trend[27]!.counts.pup).toBe(1);
    expect(trend.reduce((n, d) => n + d.total, 0)).toBe(3);
  });
});
