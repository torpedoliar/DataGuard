/**
 * Plain-language posture model for the Security pages. Pure — no DB, no
 * network. Turns raw WatchGuard enums and sync timestamps into the states and
 * buckets the UI shows, so every page agrees on what "connected", "stale" or
 * "needs attention" means.
 */

export type ConnectionState = "not_configured" | "disabled" | "syncing_first" | "stale" | "error" | "live";

export function resolveConnectionState(input: {
  configured: boolean;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  syncIntervalMinutes: number;
  nowMs: number;
}): ConnectionState {
  if (!input.configured) return "not_configured";
  if (!input.enabled) return "disabled";
  if (input.lastSyncError) return "error";
  if (!input.lastSyncAt) return "syncing_first";
  const staleAfterMs = Math.max(input.syncIntervalMinutes, 1) * 3 * 60 * 1000;
  if (input.nowMs - input.lastSyncAt.getTime() > staleAfterMs) return "stale";
  return "live";
}

/** Health buckets in severity order — the order the UI sorts and stacks. */
export const POSTURE_BUCKETS = ["disabled", "error", "install_error", "unknown", "no_license", "outdated", "protected"] as const;
export type PostureBucket = (typeof POSTURE_BUCKETS)[number];

export const ATTENTION_BUCKETS: readonly PostureBucket[] = ["disabled", "error", "install_error", "unknown"];

export function bucketForEndpoint(input: {
  accumulatedProtectionStatus: number | null;
  protectionEngineUpdateStatus: number | null;
  knowledgeCatalogUpdateStatus: number | null;
}): PostureBucket {
  switch (input.accumulatedProtectionStatus) {
    case 1:
      return input.protectionEngineUpdateStatus === 1 || input.knowledgeCatalogUpdateStatus === 1 ? "outdated" : "protected";
    case 2:
      return "disabled";
    case 3:
      return "error";
    case 4:
      return "install_error";
    case 5:
      return "no_license";
    default:
      return "unknown";
  }
}

export const OFFLINE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isOffline(lastConnectionAt: Date | null, nowMs: number): boolean {
  return lastConnectionAt !== null && nowMs - lastConnectionAt.getTime() > OFFLINE_DAYS * DAY_MS;
}

export const SERVER_DEVICE_TYPE = 3;

export type PostureEndpoint = {
  id: number;
  hostName: string;
  deviceType: number | null;
  isCritical: boolean;
  bucket: PostureBucket;
  offline: boolean;
  lastConnectionAt: Date | null;
};

export type FleetPosture = {
  total: number;
  counts: Record<PostureBucket, number>;
  offline: number;
  /** Protected share in 0..100, one decimal; null when there are no endpoints. */
  protectedPct: number | null;
  attention: PostureEndpoint[];
};

/** Rank inside the attention queue: worst bucket, then servers/critical first, then longest silent. */
function attentionRank(e: PostureEndpoint): [number, number, number] {
  const bucketRank = ATTENTION_BUCKETS.indexOf(e.bucket);
  const important = e.deviceType === SERVER_DEVICE_TYPE || e.isCritical ? 0 : 1;
  const lastSeen = e.lastConnectionAt?.getTime() ?? 0;
  return [bucketRank, important, lastSeen];
}

export function summarizeFleet(endpoints: PostureEndpoint[]): FleetPosture {
  const counts = Object.fromEntries(POSTURE_BUCKETS.map((b) => [b, 0])) as Record<PostureBucket, number>;
  let offline = 0;
  for (const e of endpoints) {
    counts[e.bucket]++;
    if (e.offline) offline++;
  }

  const attention = endpoints
    .filter((e) => ATTENTION_BUCKETS.includes(e.bucket))
    .sort((a, b) => {
      const ra = attentionRank(a);
      const rb = attentionRank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });

  const total = endpoints.length;
  const protectedCount = counts.protected + counts.outdated;
  return {
    total,
    counts,
    offline,
    protectedPct: total === 0 ? null : Math.floor((protectedCount / total) * 1000) / 10,
    attention,
  };
}

export const THREAT_CATEGORIES = ["malware", "pup", "exploit", "virus", "ioa"] as const;
export type ThreatCategory = (typeof THREAT_CATEGORIES)[number];

export type TrendDay = { date: string; counts: Record<ThreatCategory, number>; total: number };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Daily stacked counts for the last `days` days (UTC), oldest first, zero-filled. */
export function buildThreatTrend(
  detections: { category: string; detectedAt: Date }[],
  nowMs: number,
  days = 30,
): TrendDay[] {
  const today = new Date(nowMs);
  today.setUTCHours(0, 0, 0, 0);
  const out: TrendDay[] = [];
  const index = new Map<string, TrendDay>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const day: TrendDay = { date: isoDay(d), counts: { malware: 0, pup: 0, exploit: 0, virus: 0, ioa: 0 }, total: 0 };
    out.push(day);
    index.set(day.date, day);
  }
  for (const det of detections) {
    const day = index.get(isoDay(det.detectedAt));
    if (!day) continue;
    if (!(THREAT_CATEGORIES as readonly string[]).includes(det.category)) continue;
    day.counts[det.category as ThreatCategory]++;
    day.total++;
  }
  return out;
}
