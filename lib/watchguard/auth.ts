/**
 * WatchGuard OAuth authentication.
 *
 * `getToken` performs the one POST the read-only transport allows (`/oauth/token`
 * with `grant_type=client_credentials&scope=api-access`). It caches the token
 * in memory keyed by region/account/access-id + credential revision, refreshes
 * 5 minutes before expiry and de-duplicates concurrent callers to a single
 * in-flight request per key. No token cache key contains a secret value.
 */
import { mapHttpStatusToKind, redactWatchGuard, WatchGuardError } from "./errors";
import { assertWatchGuardRequest } from "./guard";
import { regionHost } from "./regions";
import type { WatchGuardCredentials, TokenResult } from "./types";
import { tokenResponseSchema } from "./schemas";

const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const EXPIRES_IN_FALLBACK_MS = 3600 * 1000;

type CacheEntry = { token: string; expiresAt: number };

const tokenCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TokenResult>>();

/** A diagnostic's tokens never read, overwrite, or invalidate normal tokens. */
const scopedCaches = new WeakMap<object, { tokenCache: typeof tokenCache; inFlight: typeof inFlight }>();

export type AuthOptions = AuthDeps & {
  credentialRevision?: number;
  fresh?: boolean;
  cacheScope?: object;
};

function cacheFor(scope?: object) {
  if (!scope) return { tokenCache, inFlight };
  let cache = scopedCaches.get(scope);
  if (!cache) {
    cache = { tokenCache: new Map(), inFlight: new Map() };
    scopedCaches.set(scope, cache);
  }
  return cache;
}

export type AuthDeps = {
  fetch?: typeof fetch;
  now?: () => number;
};

/** Non-secret cache key: region, account, access id and credential revision. */
export function authCacheKey(creds: WatchGuardCredentials, credentialRevision = 0): string {
  return [creds.region, creds.accountId, creds.accessId, credentialRevision].join("\u0000");
}

function basicHeader(creds: WatchGuardCredentials): string {
  const raw = `${creds.accessId}:${creds.password}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

export function tokenFormBody(): string {
  return new URLSearchParams({ grant_type: "client_credentials", scope: "api-access" }).toString();
}

async function requestToken(
  creds: WatchGuardCredentials,
  deps: Required<AuthDeps>,
): Promise<TokenResult> {
  const url = `https://${regionHost(creds.region)}/oauth/token`;
  const body = tokenFormBody();
  const secrets = { accessId: creds.accessId, password: creds.password };

  // The sole permitted POST — validated before any network I/O.
  assertWatchGuardRequest("POST", url, body);

  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicHeader(creds),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new WatchGuardError("timeout", "WatchGuard token request timed out");
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new WatchGuardError("network", `WatchGuard token request failed: ${redactWatchGuard(reason, secrets)}`);
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const snippet = redactWatchGuard(text, secrets).slice(0, 200);
    throw new WatchGuardError(mapHttpStatusToKind(response.status), `WatchGuard token request responded ${response.status}: ${snippet}`, {
      status: response.status,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WatchGuardError("invalid_response", `WatchGuard token request returned non-JSON: ${redactWatchGuard(text, secrets).slice(0, 200)}`);
  }

  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.access_token) {
    throw new WatchGuardError("invalid_response", "WatchGuard token response missing access_token");
  }

  const expiresInMs = (parsed.data.expires_in ?? 3600) * 1000;
  return { token: parsed.data.access_token, expiresAt: deps.now() + (expiresInMs || EXPIRES_IN_FALLBACK_MS) };
}

export const authDeps: Required<AuthDeps> = {
  fetch: globalThis.fetch,
  now: () => Date.now(),
};

/**
 * Return a valid (cached or freshly issued) token. Concurrent callers for the
 * same key await the same in-flight request instead of issuing duplicates.
 */
export async function getToken(
  creds: WatchGuardCredentials,
  options: AuthOptions = {},
): Promise<TokenResult> {
  const deps: Required<AuthDeps> = {
    fetch: options.fetch ?? authDeps.fetch,
    now: options.now ?? authDeps.now,
  };
  // A standalone fresh request is deliberately uncached. A diagnostic can
  // instead share an isolated scope with its subsequent REST checks.
  if (options.fresh) return requestToken(creds, deps);
  const { tokenCache, inFlight } = cacheFor(options.cacheScope);
  const key = authCacheKey(creds, options.credentialRevision ?? 0);

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - deps.now() > REFRESH_AHEAD_MS) {
    return { token: cached.token, expiresAt: cached.expiresAt };
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = requestToken(creds, deps)
    .then((result) => {
      tokenCache.set(key, { token: result.token, expiresAt: result.expiresAt });
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/** Drop a cached token so the next `getToken` issues a fresh one. */
export function invalidateToken(key: string, cacheScope?: object): void {
  cacheFor(cacheScope).tokenCache.delete(key);
}

/** Test/worker helper: clear the whole in-memory cache and pending requests. */
export function clearTokenCache(): void {
  tokenCache.clear();
  inFlight.clear();
}