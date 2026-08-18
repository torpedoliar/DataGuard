/**
 * Resolve the originating client IP under a proxy-trust model.
 *
 * Priority:
 *   1. X-Real-IP — a hop-by-hop header that a correctly configured reverse
 *      proxy overwrites for every request, so its value cannot be influenced
 *      by the client.
 *   2. The LAST entry of X-Forwarded-For — with a single trusted proxy in
 *      front of the app, the rightmost value is the one the proxy appended
 *      (the true client). Earlier entries are client-supplied and MUST NOT
 *      be trusted; notably the FIRST entry is fully attacker-controlled and
 *      must never be used as the rate-limit key.
 *
 * Deployment requirement: the reverse proxy must set X-Real-IP (nginx
 * `proxy_set_header X-Real-IP $remote_addr;`) or overwrite X-Forwarded-For.
 * If no trusted header is present, null is returned and callers fall back
 * to a shared bucket for every request. The buckets themselves are in
 * per-process memory — a multi-worker deployment needs a shared store
 * (Redis) for exact de-duplication; the account lockout (5 fails / 15 min)
 * remains the security backstop.
 */
export function getClientIp(
  xForwardedFor: string | null,
  xRealIp: string | null,
): string | null {
  const realIp = xRealIp?.trim();
  if (realIp) return realIp;

  const entries = xForwardedFor?.split(",");
  if (entries && entries.length > 0) {
    const last = entries[entries.length - 1]?.trim();
    if (last) return last;
  }
  return null;
}

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
