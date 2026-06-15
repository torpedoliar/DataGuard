export type RateLimitConfig = {
  windowMs: number;
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

/**
 * In-memory token-bucket approximation (sliding window of timestamps) keyed
 * by (routeKey, key). Returns whether the call is allowed, how many calls
 * remain in the current window, and the time until the next slot frees up.
 *
 * State is per-process; in a multi-worker deployment each worker has its own
 * bucket. That is acceptable for low-volume limits like 5/min because the
 * effective ceiling is `max * numWorkers`. For tighter guarantees, swap the
 * underlying store for Redis.
 */
const buckets = new Map<string, Map<string, number[]>>();

export function checkRateLimit(
  routeKey: string,
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let routeBuckets = buckets.get(routeKey);
  if (!routeBuckets) {
    routeBuckets = new Map();
    buckets.set(routeKey, routeBuckets);
  }

  let timestamps = routeBuckets.get(key) ?? [];

  // Drop expired timestamps.
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= config.max) {
    const oldest = timestamps[0];
    const resetMs = Math.max(0, oldest + config.windowMs - now);
    routeBuckets.set(key, timestamps);
    return { allowed: false, remaining: 0, resetMs };
  }

  timestamps.push(now);
  routeBuckets.set(key, timestamps);

  const oldest = timestamps[0];
  const resetMs = Math.max(0, oldest + config.windowMs - now);
  return {
    allowed: true,
    remaining: config.max - timestamps.length,
    resetMs,
  };
}

/**
 * Test-only: wipe the in-memory bucket store. Production code should never
 * need to call this; it exists so unit tests can start from a clean slate.
 */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
}
