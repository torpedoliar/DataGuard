import { beforeEach, describe, expect, it, vi } from "vitest";
import { authCacheKey, clearTokenCache, getToken, invalidateToken, tokenFormBody } from "./auth";
import type { WatchGuardCredentials } from "./types";

const creds: WatchGuardCredentials = {
  region: "jpn",
  accountId: "WGC-3-123456",
  accessId: "ACCESS-abc",
  password: "s3cr3t-password",
  apiKey: "pre-shared-api-key",
};

function tokenJson(token: string) {
  return new Response(JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 3600 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearTokenCache();
});

describe("getToken — request shape", () => {
  it("POSTs to the regional /oauth/token with Basic auth and exact form body", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
      void _url;
      void _init;
      return tokenJson("tok-1");
    });
    const now = vi.fn(() => 1_000_000);

    const result = await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });

    const [requestedUrl, init] = fetchMock.mock.calls[0]!;
    expect(requestedUrl).toBe("https://api.jpn.cloud.watchguard.com/oauth/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("ACCESS-abc:s3cr3t-password").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(init?.body).toBe(tokenFormBody());
    expect(result.token).toBe("tok-1");
    expect(result.expiresAt).toBe(1_000_000 + 3600 * 1000);
  });

  it("uses the tokenFormBody shape required by the read-only guard", () => {
    expect(tokenFormBody()).toBe("grant_type=client_credentials&scope=api-access");
  });
});

describe("getToken — caching and concurrency", () => {
  it("reuses the cached token and does not re-fetch", async () => {
    const fetchMock = vi.fn(async () => tokenJson("tok-1"));
    const now = vi.fn(() => 1_000_000);

    const a = await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });
    const b = await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });

    expect(a.token).toBe("tok-1");
    expect(b.token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes before expiry (5 min ahead)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenJson("tok-1"))
      .mockResolvedValueOnce(tokenJson("tok-2"));
    // First call at t0 caches tok-1 expiring at t0+3600s.
    const t0 = 1_000_000;
    let now = t0;
    const nowFn = vi.fn(() => now);

    await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now: nowFn });
    // 6 minutes before expiry -> still cached.
    now = t0 + 3600 * 1000 - 6 * 60 * 1000;
    const same = await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now: nowFn });
    expect(same.token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 4 minutes before expiry -> inside the refresh-ahead window, refetch.
    now = t0 + 3600 * 1000 - 4 * 60 * 1000;
    const refreshed = await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now: nowFn });
    expect(refreshed.token).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent callers to a single in-flight request", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
    const now = vi.fn(() => 1_000_000);

    const p1 = getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });
    const p2 = getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });
    resolveFetch(tokenJson("tok-1"));

    const [a, b] = await Promise.all([p1, p2]);
    expect(a.token).toBe("tok-1");
    expect(b.token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates a cached entry so the next call refetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenJson("tok-1"))
      .mockResolvedValueOnce(tokenJson("tok-2"));
    const now = vi.fn(() => 1_000_000);

    await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });
    invalidateToken(authCacheKey(creds));
    const again = await getToken(creds, { fetch: fetchMock as unknown as typeof fetch, now });
    expect(again.token).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});