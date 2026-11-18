import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWriteOperation, type WriteOperation } from "@/lib/epdr/execution-capability";
import { clearTokenCache } from "./auth";
import type { WatchGuardCredentials } from "./types";
import { createWatchGuardWriteTransport } from "./write-client";

const creds: WatchGuardCredentials = {
  region: "jpn",
  accountId: "WGC-3-123456",
  accessId: "RW-access-id",
  password: "rw-password-value",
  apiKey: "api-key-value",
};

function op(actionType: string, namespace: "endpoint_security" | "threatsync" = "endpoint_security"): WriteOperation {
  const found = getWriteOperation(namespace, actionType);
  if (!found) throw new Error(`missing ${namespace}/${actionType}`);
  return found;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = { method: string; url: URL; body: string | null; headers: Headers };

function routedFetch(route: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (rawUrl: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(rawUrl));
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    calls.push({
      method: ((init?.method ?? "GET") as string).toUpperCase(),
      url,
      body: typeof init?.body === "string" ? init.body : null,
      headers,
    });
    return route(url, init ?? {});
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const TOKEN_PATH = "/oauth/token";

beforeEach(() => {
  clearTokenCache();
});

describe("write transport", () => {
  it("sends exactly one request and never retries a 5xx", async () => {
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      return json({ error: "boom" }, 503);
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    const result = await transport.send({
      credentials: creds,
      operation: op("isolate"),
      body: { device_ids: ["dev-1"] },
      enabled: true,
      credentialMode: "write",
    });

    expect(result).toMatchObject({ kind: "sent", status: 503 });
    expect(calls.filter((call) => call.url.pathname !== TOKEN_PATH)).toHaveLength(1);
  });

  it("refuses to touch the network when the guard blocks the request", async () => {
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      return json({ task_id: "1" });
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    const disabled = await transport.send({
      credentials: creds,
      operation: op("scan"),
      body: { device_ids: ["dev-1"], task_name: "dcheck-1" },
      enabled: false,
      credentialMode: "write",
    });
    expect(disabled).toEqual({ kind: "blocked", reason: "write_disabled" });

    const readOnly = await transport.send({
      credentials: creds,
      operation: op("scan"),
      body: { device_ids: ["dev-1"], task_name: "dcheck-1" },
      enabled: true,
      credentialMode: "read",
    });
    expect(readOnly).toEqual({ kind: "blocked", reason: "read_credentials" });

    expect(calls).toHaveLength(0);
  });

  it("sends the documented headers and body to the exact path", async () => {
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      return json({ task_id: "task-7" });
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    await transport.send({
      credentials: creds,
      operation: op("scan"),
      body: { device_ids: ["dev-1"], task_name: "dcheck-9 host" },
      enabled: true,
      credentialMode: "write",
    });

    const write = calls.find((call) => call.url.pathname !== TOKEN_PATH);
    expect(write?.method).toBe("POST");
    expect(write?.url.pathname).toBe(
      `/rest/endpoint-security/management/api/v1/accounts/${creds.accountId}/immediatescan`,
    );
    expect(write?.headers.get("authorization")).toBe("Bearer tok");
    expect(write?.headers.get("watchguard-api-key")).toBe(creds.apiKey);
    expect(write?.headers.get("content-type")).toBe("application/json");
    expect(write?.body).toContain("dev-1");
  });

  it("reports a timeout as an ambiguous transport fact, not a rejection", async () => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    const result = await transport.send({
      credentials: creds,
      operation: op("isolate"),
      body: { device_ids: ["dev-1"] },
      enabled: true,
      credentialMode: "write",
    });
    expect(result).toEqual({ kind: "timed_out" });
  });

  it("never leaks the password or api key in a network error message", async () => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      throw new Error(`connect ECONNREFUSED ${creds.password} ${creds.apiKey}`);
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    const result = await transport.send({
      credentials: creds,
      operation: op("isolate"),
      body: { device_ids: ["dev-1"] },
      enabled: true,
      credentialMode: "write",
    });
    expect(result.kind).toBe("network_error");
    if (result.kind === "network_error") {
      expect(result.message).not.toContain(creds.password);
      expect(result.message).not.toContain(creds.apiKey);
    }
  });

  it("redacts credentials from a provider error body", async () => {
    const { fetchImpl } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      return new Response(`denied for ${creds.password}`, { status: 403 });
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    const result = await transport.send({
      credentials: creds,
      operation: op("isolate"),
      body: { device_ids: ["dev-1"] },
      enabled: true,
      credentialMode: "write",
    });
    expect(result.kind).toBe("sent");
    if (result.kind === "sent") {
      expect(result.snippet).not.toContain(creds.password);
      expect(result.status).toBe(403);
    }
  });

  it("does not send a provider request when the token exchange fails", async () => {
    const { fetchImpl, calls } = routedFetch(() => json({ error: "invalid_client" }, 401));
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    const result = await transport.send({
      credentials: creds,
      operation: op("isolate"),
      body: { device_ids: ["dev-1"] },
      enabled: true,
      credentialMode: "write",
    });
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") expect(result.reason).toBe("token_exchange_failed");
    expect(calls.every((call) => call.url.pathname === TOKEN_PATH)).toBe(true);
  });

  it("uses the PATCH method and path parameter for a configuration assignment", async () => {
    const { fetchImpl, calls } = routedFetch((url) => {
      if (url.pathname === TOKEN_PATH) return json({ access_token: "tok", expires_in: 3600 });
      return new Response("", { status: 200 });
    });
    const transport = createWatchGuardWriteTransport({ fetch: fetchImpl });

    await transport.send({
      credentials: creds,
      operation: op("assign_config"),
      pathParams: { configId: "cfg-42" },
      body: { device_ids: ["dev-1"] },
      enabled: true,
      credentialMode: "write",
    });

    const write = calls.find((call) => call.url.pathname !== TOKEN_PATH);
    expect(write?.method).toBe("PATCH");
    expect(write?.url.pathname).toBe(
      `/rest/endpoint-security/management/api/v1/accounts/${creds.accountId}/managedconfigurations/2/cfg-42`,
    );
  });
});
