import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWatchGuardClient } from "./client";
import { clearTokenCache, getToken } from "./auth";
import { runServiceChecks } from "./connection";
import { WatchGuardError } from "./errors";
import { READ_ONLY_BLOCKED } from "./guard";
import type { WatchGuardCredentials } from "./types";

import devicesFixture from "./fixtures/devices.json";
import threatSyncIncidentsFixture from "./fixtures/threatsync-incidents.json";

const creds: WatchGuardCredentials = {
  region: "jpn",
  accountId: "WGC-3-123456",
  accessId: "ACCESS-abc",
  password: "s3cr3t-password",
  apiKey: "pre-shared-api-key",
};

const ACCOUNT = "WGC-3-123456";
const DEVICES_PATH = `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`;
const TOKEN_PATH = "/oauth/token";

type Call = { method: string; url: URL };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function tokenResponse() {
  return json({ access_token: "tok-abc", token_type: "Bearer", expires_in: 3600 });
}

function routedFetch(route: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (rawUrl: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(rawUrl));
    calls.push({ method: ((init?.method ?? "GET") as string).toUpperCase(), url });
    return route(url, init ?? {});
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function apiCalls(calls: Call[]): Call[] {
  return calls.filter((c) => c.url.pathname !== TOKEN_PATH);
}

beforeEach(() => {
  clearTokenCache();
});

describe("client reads", () => {
  it("lists devices and normalizes the {data,total_items} envelope", async () => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      if (url.pathname === DEVICES_PATH) return json(devicesFixture);
      throw new Error(`unexpected ${url.toString()}`);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const page = await client.listDevices({ top: 50, skip: 0, count: true });

    expect(page.totalItems).toBe(613);
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.device_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("sends the documented $top/$skip/$count query keys", async () => {
    let captured: URL | null = null;
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      captured = url;
      return json(devicesFixture);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    await client.listDevices({ top: 50, skip: 0, count: true });

    expect(captured!.search).toContain("$top=50");
    expect(captured!.search).toContain("$skip=0");
    expect(captured!.search).toContain("$count=true");
  });

  it("paginates iterateDevices until total_items is reached", async () => {
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      const skip = Number(url.searchParams.get("$skip") ?? "0");
      // Two pages of two items each, total 4.
      const slice = Array.from({ length: 2 }, (_, i) => ({ device_id: `dev-${skip + i}` }));
      return json({ data: slice, total_items: 4 });
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const collected: string[] = [];
    for await (const device of client.iterateDevices({ pageSize: 2 })) {
      collected.push(device.device_id!);
    }
    expect(collected).toHaveLength(4);
    expect(apiCalls(calls).length).toBe(2);
  });

  it("paginates ThreatSync incidents with the startAfter cursor", async () => {
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      const startAfter = url.searchParams.get("startAfter");
      // First page full (limit 2), second page 1 item.
      if (!startAfter) return json(threatSyncIncidentsFixture);
      return json({ items: [{ ...(threatSyncIncidentsFixture.items[0] as object), id: "ts-incident-0003" }], count: 3 });
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const collected: string[] = [];
    for await (const incident of client.iterateIncidents({ limit: 2 })) {
      collected.push(incident.id!);
    }
    expect(collected).toEqual(["ts-incident-0001", "ts-incident-0002", "ts-incident-0003"]);
    expect(apiCalls(calls).length).toBe(2);
  });
});

describe("documented ThreatSync responses", () => {
  const incident = {
    id: "synthetic-incident", category: "av", type: "Malware", threatScore: 9,
    severity: "High", status: "new", remediated: false,
    entities: { "synthetic-entity": { type: "computer", recommendedActions: [{ command: "isolate" }] } },
  };

  it.each(["items", "groups"])("normalizes the %s envelope and entity map", async (envelope) => {
    const body = envelope === "items" ? { items: [incident], count: 1 } : { groups: { _default: [incident] }, count: 1 };
    const { fetchImpl, calls } = routedFetch((url) => url.pathname === TOKEN_PATH ? tokenResponse() : json(body));
    const client = createWatchGuardClient(creds, { fetch: fetchImpl });
    const page = await client.listIncidents({ limit: 1 });
    expect(page.data[0]?.threat_score).toBe(9);
    expect(page.data[0]?.entities).toEqual([{ entityId: "synthetic-entity", type: "computer", recommendedActions: [{ command: "isolate" }] }]);
    expect(page.startAfter).toBe(incident.id);
    expect(apiCalls(calls).every((call) => call.method === "GET")).toBe(true);
  });

  it.each([{ items: [], count: 0 }, { groups: { _default: [] }, count: 0 }])("accepts documented empty lists", async (body) => {
    const { fetchImpl } = routedFetch((url) => url.pathname === TOKEN_PATH ? tokenResponse() : json(body));
    expect((await createWatchGuardClient(creds, { fetch: fetchImpl }).listIncidents()).data).toEqual([]);
  });

  it.each([{ data: [] }, { items: null }, { groups: {} }, { items: [incident], count: "1" }])("rejects malformed envelopes", async (body) => {
    const { fetchImpl } = routedFetch((url) => url.pathname === TOKEN_PATH ? tokenResponse() : json(body));
    await expect(createWatchGuardClient(creds, { fetch: fetchImpl }).listIncidents()).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it.each([true, false])("runs real client service checks with valid=%s ThreatSync payload", async (valid) => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      if (url.pathname.endsWith("/incidents")) return json(valid ? { groups: { _default: [incident] }, count: 1 } : { groups: {} });
      return json({});
    });
    const options = { fetch: fetchImpl };
    const client = createWatchGuardClient(creds, options);
    const result = await runServiceChecks({
      getToken: () => getToken(creds, options),
      getAccount: () => client.getAccount(),
      getLicenses: () => client.getLicenses(),
      listIncidents: () => client.listIncidents({ limit: 1 }),
    });
    expect(result.auth.ok).toBe(true);
    expect(result.account.ok).toBe(true);
    expect(result.endpointSecurity.ok).toBe(true);
    expect(result.threatSync.ok).toBe(valid);
    if (!valid) expect(result.threatSync.kind).toBe("invalid_response");
  });

  it("reports a safe field name without leaking response values or entity IDs", async () => {
    const body = { items: [{ ...incident, entities: { "private-host-identity": "private-value" } }] };
    const { fetchImpl } = routedFetch((url) => url.pathname === TOKEN_PATH ? tokenResponse() : json(body));
    await expect(createWatchGuardClient(creds, { fetch: fetchImpl }).listIncidents()).rejects.toMatchObject({
      kind: "invalid_response", message: "WatchGuard incidents: invalid field type (entities)",
    });
  });
});

describe("client retry + refresh", () => {
  it("retries a 429 honoring Retry-After, then succeeds", async () => {
    let apiAttempts = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      apiAttempts += 1;
      if (apiAttempts === 1) return json({ error: "slow down" }, 429, { "Retry-After": "2" });
      return json(devicesFixture);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep });
    const page = await client.listDevices();
    expect(page.data).toHaveLength(2);
    expect(apiAttempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries a 503 then succeeds", async () => {
    let apiAttempts = 0;
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      apiAttempts += 1;
      if (apiAttempts === 1) return json({ error: "unavailable" }, 503);
      return json(devicesFixture);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const page = await client.listDevices();
    expect(page.data).toHaveLength(2);
    expect(apiAttempts).toBe(2);
  });

  it("retries a timeout on a GET, marking transient failures as network/timeout", async () => {
    let apiAttempts = 0;
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      apiAttempts += 1;
      if (apiAttempts === 1) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      return json(devicesFixture);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const page = await client.listDevices();
    expect(page.data).toHaveLength(2);
    expect(apiAttempts).toBe(2);
  });

  it("refreshes the token once on a 401 and retries", async () => {
    let tokenAttempts = 0;
    let apiAttempts = 0;
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) {
        tokenAttempts += 1;
        return tokenResponse();
      }
      apiAttempts += 1;
      if (apiAttempts === 1) return json({ error: "Undefined" }, 401);
      return json(devicesFixture);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const page = await client.listDevices();
    expect(page.data).toHaveLength(2);
    expect(tokenAttempts).toBe(2);
    expect(apiAttempts).toBe(2);
    expect(calls.filter((c) => c.method === "POST").length).toBe(2);
  });

  it("throws auth (no loop) when a refreshed token also 401s", async () => {
    let tokenAttempts = 0;
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) {
        tokenAttempts += 1;
        return tokenResponse();
      }
      return json({ error: "Undefined" }, 401);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    await expect(client.listDevices()).rejects.toMatchObject({ kind: "auth" });
    expect(tokenAttempts).toBe(2);
  });
});

describe("client error mapping + redaction", () => {
  it.each([
    [400, "Invalid Username/Password", "auth"],
    [401, "Undefined", "auth"],
    [403, "11002", "forbidden"],
    [404, "not found", "not_found"],
    [429, "rate", "rate_limited"],
    [500, "oops", "server"],
  ])("maps %d → %s", async (status, body, kind) => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      return json({ error: body }, status);
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    await expect(client.listDevices()).rejects.toMatchObject({ kind });
  });

  it("never leaks password, apiKey or token into an error message", async () => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return tokenResponse();
      // Provider error body that echoes every secret.
      return json(
        { error: `leak password=s3cr3t-password apiKey=pre-shared-api-key token=tok-abc accessId=ACCESS-abc` },
        500,
      );
    });

    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });
    const err = (await client.listDevices().catch((e) => e)) as WatchGuardError;
    expect(err).toBeInstanceOf(WatchGuardError);
    expect(err.message).not.toContain("s3cr3t-password");
    expect(err.message).not.toContain("pre-shared-api-key");
    expect(err.message).not.toContain("tok-abc");
    expect(err.message).not.toContain("ACCESS-abc");
  });
});

describe("read-only transport: every write is blocked before network", () => {
  it("rejects every mutating method with zero API/token fetch calls", async () => {
    const { fetchImpl, calls } = routedFetch(() => {
      throw new Error("should never be called");
    });
    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });

    const writes: Array<() => Promise<unknown>> = [
      () => client.startImmediateScan({ device_ids: ["d"], scan_scope: 0 }),
      () => client.rebootDevices(["d"], 7),
      () => client.isolateDevices({ device_ids: ["d"] }),
      () => client.unisolateDevices(["d"]),
      () => client.assignConfiguration("cfg", ["d"]),
      () => client.updateIncidentStatus("ts-1", "closed"),
      () => client.addIncidentComment("ts-1", "hello"),
      () => client.performIncidentAction("ts-1", { command: "killProcess", entityId: "e" }),
    ];

    for (const write of writes) {
      const e = (await write().catch((x) => x)) as WatchGuardError;
      expect(e).toBeInstanceOf(WatchGuardError);
      expect(e.kind).toBe("read_only_blocked");
      expect(e.message).toContain(READ_ONLY_BLOCKED);
    }

    expect(calls).toHaveLength(0);
  });

  it("does not permit a write even when credentials/approval-looking params are present", async () => {
    const { fetchImpl, calls } = routedFetch(() => {
      throw new Error("should never be called");
    });
    const client = createWatchGuardClient(creds, { fetch: fetchImpl, sleep: vi.fn().mockResolvedValue(undefined) });

    await expect(
      client.startImmediateScan({ device_ids: ["d"], scan_scope: 0, _approved: true }),
    ).rejects.toMatchObject({ kind: "read_only_blocked" });
    expect(calls).toHaveLength(0);
  });
});