import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  updateSets: [] as unknown[],
  updateCalls: 0,
}));

vi.mock("../db", () => {
  const select = () => ({
    from: () => {
      const thenable = {
        then: (onFulfilled: (value: unknown[]) => unknown) => {
          const result = mocks.selectResults.shift();
          return Promise.resolve(result ?? []).then(onFulfilled);
        },
      };
      return {
        ...thenable,
        where: () => thenable,
        limit: () => thenable,
      };
    },
  });

  const update = () => ({
    set: (set: unknown) => {
      mocks.updateSets.push(set);
      mocks.updateCalls++;
      return {
        where: () => Promise.resolve(undefined),
      };
    },
  });

  return { db: { select, update } };
});

import { fetchNcmBackups, fetchNcmReviews, fetchNcmSwitches, resolveNcmConfig, touchNcmLastSeen } from "./ncm";
import { encryptString } from "./crypto";

const API_URL = "http://10.0.0.9:9443";
const API_KEY = "ncm-admin-key";

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => "forbidden",
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectResults.length = 0;
  mocks.updateSets.length = 0;
  mocks.updateCalls = 0;
  process.env.AI_KEY_ENCRYPTION_SECRET = "test-encryption-secret-that-is-long-enough-32";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNcmSwitches (and backups/reviews wrappers)", () => {
  it("sends X-API-Key with a 10s timeout to /api/v1/ncm/switches", async () => {
    const fetchMock = stubFetch([{ id: 1 }]);

    const result = await fetchNcmSwitches({ url: `${API_URL}/`, adminApiKey: API_KEY });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/ncm/switches`);
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual([{ id: 1 }]);
  });

  it("hits the backups and reviews endpoints", async () => {
    const fetchMock = stubFetch([]);
    await fetchNcmBackups({ url: API_URL, adminApiKey: API_KEY });
    await fetchNcmReviews({ url: API_URL, adminApiKey: API_KEY });
    const urls = fetchMock.mock.calls.map((call) => (call as [string])[0]);
    expect(urls).toEqual([`${API_URL}/api/v1/ncm/backups`, `${API_URL}/api/v1/ncm/reviews`]);
  });

  it("throws with the status on a non-OK response", async () => {
    stubFetch([], false, 403);
    await expect(fetchNcmSwitches({ url: API_URL, adminApiKey: API_KEY })).rejects.toThrow("403");
  });

  it("includes the attempted URL when the connection fails (localhost-in-Docker is the container)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(fetchNcmSwitches({ url: API_URL, adminApiKey: API_KEY })).rejects.toThrow(
      `Gagal terhubung ke ${API_URL}/api/v1/ncm/switches`,
    );
  });
});

describe("resolveNcmConfig", () => {
  it("returns the decrypted key and trimmed url from the site row", async () => {
    mocks.selectResults.push([{ url: `${API_URL} `, adminApiKey: encryptString(API_KEY) }]);

    const config = await resolveNcmConfig(7);

    expect(config.url).toBe(API_URL);
    expect(config.adminApiKey).toBe(API_KEY);
  });

  it("returns nulls when the site has no row (soft, no throw)", async () => {
    mocks.selectResults.push([]);

    const config = await resolveNcmConfig(7);

    expect(config).toEqual({ url: null, adminApiKey: null });
  });
});

describe("touchNcmLastSeen", () => {
  it("writes lastSeenAt for the site row", async () => {
    await touchNcmLastSeen(7);

    expect(mocks.updateCalls).toBe(1);
    const set = mocks.updateSets[0] as { lastSeenAt?: Date };
    expect(set.lastSeenAt).toBeInstanceOf(Date);
  });
});
