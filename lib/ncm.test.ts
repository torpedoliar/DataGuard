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

import {
  createNcmBaseline,
  createNcmCredentials,
  createNcmJob,
  createNcmSwitch,
  decideNcmReview,
  deleteNcmBaseline,
  deleteNcmCredentials,
  deleteNcmJob,
  deleteNcmSwitch,
  fetchNcmBackups,
  fetchNcmBaselines,
  fetchNcmJobs,
  fetchNcmReview,
  fetchNcmReviewRollback,
  fetchNcmReviews,
  fetchNcmSwitches,
  getNcmLastSeen,
  refreshNcmBaseline,
  resolveNcmConfig,
  touchNcmLastSeen,
  triggerNcmBackup,
  updateNcmCredentials,
  updateNcmJob,
  updateNcmSwitch,
} from "./ncm";
import { encryptString } from "./crypto";

const API_URL = "http://10.0.0.9:9443";
const API_KEY = "ncm-admin-key";

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (ok ? JSON.stringify(payload) : "forbidden"),
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
  it("sends X-API-Key with a 10s timeout to /api/v1/switches", async () => {
    const fetchMock = stubFetch([{ id: 1 }]);

    const result = await fetchNcmSwitches({ url: `${API_URL}/`, adminApiKey: API_KEY });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/switches`);
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual([{ id: 1 }]);
  });

  it("hits the backups and reviews endpoints", async () => {
    const fetchMock = stubFetch([]);
    await fetchNcmBackups({ url: API_URL, adminApiKey: API_KEY });
    await fetchNcmReviews({ url: API_URL, adminApiKey: API_KEY });
    const urls = fetchMock.mock.calls.map((call) => (call as [string])[0]);
    expect(urls).toEqual([`${API_URL}/api/v1/backups`, `${API_URL}/api/v1/reviews`]);
  });

  it("throws with the status on a non-OK response", async () => {
    stubFetch([], false, 403);
    await expect(fetchNcmSwitches({ url: API_URL, adminApiKey: API_KEY })).rejects.toThrow("403");
  });

  it("includes the attempted URL when the connection fails (localhost-in-Docker is the container)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(fetchNcmSwitches({ url: API_URL, adminApiKey: API_KEY })).rejects.toThrow(
      `Gagal terhubung ke ${API_URL}/api/v1/switches`,
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

describe("write endpoints (ticket 02 scopes)", () => {
  const conn = { url: API_URL, adminApiKey: API_KEY };

  it("POSTs a new switch to /api/v1/switches as JSON", async () => {
    const fetchMock = stubFetch({ id: 3 });
    const body = { name: "core-1", ip: "10.0.0.3" };

    const result = await createNcmSwitch(conn, body);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/switches`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("application/json");
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(result).toEqual({ id: 3 });
  });

  it("PATCHes and DELETEs a switch at /api/v1/switches/{id}", async () => {
    const fetchMock = stubFetch({ ok: true });

    await updateNcmSwitch(conn, 3, { name: "core-1b" });
    await deleteNcmSwitch(conn, 3);

    const [updateUrl, updateInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe(`${API_URL}/api/v1/switches/3`);
    expect(updateInit.method).toBe("PATCH");
    expect(JSON.parse(updateInit.body as string)).toEqual({ name: "core-1b" });
    expect(deleteUrl).toBe(`${API_URL}/api/v1/switches/3`);
    expect(deleteInit.method).toBe("DELETE");
  });

  it("manages credentials (one-way pass-through, create + re-point, secrets never echoed)", async () => {
    // Every fetch returns { id: 11 } EXCEPT the switches-list GET inside
    // deleteNcmCredentials, which must be a switches ARRAY carrying
    // credential_id so the helper can resolve the DELETE target.
    const payloadFor = (url: unknown): unknown =>
        String(url).endsWith("/api/v1/switches") ? [{ id: 3, credential_id: 11 }] : { id: 11 };
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      const json = JSON.stringify(payloadFor(url));
      return { ok: true, status: 200, text: async () => json, json: async () => payloadFor(url) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await createNcmCredentials(conn, 3, { username: "admin", password: "s3cret!" });
    await updateNcmCredentials(conn, 3, { password: "r0tated!" });
    mocks.selectResults;
    await deleteNcmCredentials(conn, 3);

    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [repointUrl, repointInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [updateUrl, updateInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const [repoint2Url, repoint2Init] = fetchMock.mock.calls[3] as [string, RequestInit];
    const [listUrl] = fetchMock.mock.calls[4] as [string];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[5] as [string, RequestInit];
    // create: global /credentials router with the switch-derived name…
    expect(createUrl).toBe(`${API_URL}/api/v1/credentials`);
    expect(createInit.method).toBe("POST");
    const createdBody = JSON.parse(createInit.body as string) as Record<string, unknown>;
    expect(createdBody.password).toBe("s3cret!");
    expect(createdBody.name).toBe("dg-switch-3");
    // …then re-point the switch at the new credential (rotation = one-way write).
    expect(repointUrl).toBe(`${API_URL}/api/v1/switches/3`);
    expect(repointInit.method).toBe("PATCH");
    expect(JSON.parse(repointInit.body as string)).toEqual({ credential_id: 11 });
    // update = same create + re-point composition.
    expect(updateUrl).toBe(`${API_URL}/api/v1/credentials`);
    expect(updateInit.method).toBe("POST");
    expect(repoint2Url).toBe(`${API_URL}/api/v1/switches/3`);
    expect(repoint2Init.method).toBe("PATCH");
    // delete resolves the switch's credential via the switches list.
    expect(listUrl).toBe(`${API_URL}/api/v1/switches`);
    expect(deleteUrl).toBe(`${API_URL}/api/v1/credentials/11`);
    expect(deleteInit.method).toBe("DELETE");
  });

  it("manages jobs via the schedules endpoints", async () => {
    const fetchMock = stubFetch([]);

    await fetchNcmJobs(conn);
    await createNcmJob(conn, { switch_id: 3, schedule: "0 2 * * *" });
    await updateNcmJob(conn, 9, { enabled: false });
    await deleteNcmJob(conn, 9);

    const [readUrl] = fetchMock.mock.calls[0] as [string];
    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [updateUrl, updateInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(readUrl).toBe(`${API_URL}/api/v1/jobs`);
    expect(createUrl).toBe(`${API_URL}/api/v1/jobs`);
    expect(createInit.method).toBe("POST");
    expect(updateUrl).toBe(`${API_URL}/api/v1/jobs/9`);
    expect(updateInit.method).toBe("PATCH");
    expect(deleteUrl).toBe(`${API_URL}/api/v1/jobs/9`);
    expect(deleteInit.method).toBe("DELETE");
  });

  it("manages baselines (create resolves kind/switch_id + refresh + delete)", async () => {
    const fetchMock = stubFetch([{ id: 1 }, { id: 5, switch_id: 3 }, { id: 2 }]);

    await fetchNcmBaselines(conn);
    await createNcmBaseline(conn, { backup_id: 5 });
    await refreshNcmBaseline(conn, 2);
    await deleteNcmBaseline(conn, 2);

    const [readUrl] = fetchMock.mock.calls[0] as [string];
    const [backupsUrl] = fetchMock.mock.calls[1] as [string];
    const [createUrl, createInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(readUrl).toBe(`${API_URL}/api/v1/baselines`);
    // backup_id-only body: kind + switch_id are resolved from the backup list.
    expect(backupsUrl).toBe(`${API_URL}/api/v1/backups`);
    expect(createUrl).toBe(`${API_URL}/api/v1/baselines`);
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(createInit.body as string)).toEqual({ kind: "switch", backup_id: 5, switch_id: 3 });
    expect(refreshUrl).toBe(`${API_URL}/api/v1/baselines/2/refresh`);
    expect(refreshInit.method).toBe("POST");
    expect(deleteUrl).toBe(`${API_URL}/api/v1/baselines/2`);
    expect(deleteInit.method).toBe("DELETE");
  });

  it("triggers on-demand backup via POST /api/v1/switches/{id}/backup", async () => {
    const fetchMock = stubFetch({ backup_id: 8 });

    const result = await triggerNcmBackup(conn, 3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/switches/3/backup`);
    expect(init.method).toBe("POST");
    expect(result).toEqual({ backup_id: 8 });
  });

  it("fetches the review diff, decides it with a note, and loads its rollback", async () => {
    const fetchMock = stubFetch("--- a\n+++ b");

    await fetchNcmReview(conn, 4);
    await decideNcmReview(conn, 4, { decision: "approve", note: "sesuai change request" });
    await fetchNcmReviewRollback(conn, 4);

    const [detailUrl, detailInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [decideUrl, decideInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [rollbackUrl] = fetchMock.mock.calls[2] as [string];
    // Detail is the raw-diff text endpoint (no JSON GET /reviews/{id} on NCM).
    expect(detailUrl).toBe(`${API_URL}/api/v1/reviews/4/diff`);
    expect(detailInit.method ?? "GET").toBe("GET");
    // Decision is POST /status (approved|flagged) — NCM's contract for keys.
    expect(decideUrl).toBe(`${API_URL}/api/v1/reviews/4/status`);
    expect(decideInit.method).toBe("POST");
    expect(JSON.parse(decideInit.body as string)).toEqual({
      status: "approved",
      comment: "sesuai change request",
    });
    expect(rollbackUrl).toBe(`${API_URL}/api/v1/reviews/4/rollback`);
  });

  it("maps a reject decision to the flagged status", async () => {
    const fetchMock = stubFetch({ status: "flagged" });

    await decideNcmReview(conn, 4, { decision: "reject" });

    const [decideUrl, decideInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(decideUrl).toBe(`${API_URL}/api/v1/reviews/4/status`);
    expect(JSON.parse(decideInit.body as string)).toEqual({ status: "flagged" });
  });

  it("surfaces the status on a failed write", async () => {
    stubFetch([], false, 403);

    await expect(createNcmSwitch(conn, { name: "x" })).rejects.toThrow("403");
  });
});

describe("getNcmLastSeen", () => {
  it("returns the stored heartbeat timestamp", async () => {
    const seen = new Date("2026-09-09T10:00:00Z");
    mocks.selectResults.push([{ lastSeenAt: seen }]);

    await expect(getNcmLastSeen(7)).resolves.toEqual(seen);
  });

  it("returns null when the site has no row", async () => {
    mocks.selectResults.push([]);

    await expect(getNcmLastSeen(7)).resolves.toBeNull();
  });
});
