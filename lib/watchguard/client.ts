/**
 * WatchGuard Cloud API client (server-only).
 *
 * All real provider I/O goes through {@link performGet} (read GETs) and the
 * auth module's token POST. Both cross the read-only transport guard; every
 * mutating method below is a *blocked adapter* that rejects with
 * `WATCHGUARD_READ_ONLY_BLOCKED` before opening a connection. There is no
 * `allowWrites` switch and no mock transport is selectable from configuration.
 *
 * `fetch` and `now` are injectable so tests exercise retry/refresh/token
 * behaviour with a fake clock and a fake fetch with zero network.
 */
import { z } from "zod";
import {
  mapHttpStatusToKind,
  redactWatchGuard,
  WatchGuardError,
  type WatchGuardErrorKind,
  type WatchGuardSecrets,
} from "./errors";
import { assertWatchGuardRequest } from "./guard";
import { authCacheKey, getToken, invalidateToken } from "./auth";
import { regionHost } from "./regions";
import type { WatchGuardCredentials, PagedResult } from "./types";
import {
  accountSchema,
  deviceSchema,
  managedConfigurationSchema,
  protectionStatusSchema,
  securityEventSchema,
  taskJobStatusSchema,
  taskSchema,
  threatSyncActionSchema,
  threatSyncIncidentSchema,
  unmanagedDeviceSchema,
  type DeviceRecord,
  type ProtectionStatusRecord,
  type SecurityEventRecord,
  type ThreatSyncIncidentRecord,
} from "./schemas";

const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000];
const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const RETRY_AFTER_CAP_MS = 60_000;

const RETRYABLE_KINDS: ReadonlySet<WatchGuardErrorKind> = new Set([
  "network",
  "timeout",
  "rate_limited",
  "server",
]);

export type WatchGuardClientOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Material change in stored credentials; invalidates cached tokens. */
  credentialRevision?: number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

function isRetryable(kind: WatchGuardErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

/** Normalize the provider `{data,total_items}` or bare-array list envelopes. */
function normalizePage<T>(raw: unknown, itemSchema: z.ZodType<T>, context: string): PagedResult<T> {
  if (raw === null || raw === undefined) {
    throw new WatchGuardError("invalid_response", `WatchGuard ${context}: empty response`);
  }
  if (Array.isArray(raw)) {
    return { data: raw.map((item) => parseItem(itemSchema, item, context)), totalItems: null };
  }
  if (typeof raw !== "object") {
    throw new WatchGuardError("invalid_response", `WatchGuard ${context}: unexpected response shape`);
  }
  const envelope = raw as { data?: unknown; total_items?: unknown };
  if (!Array.isArray(envelope.data)) {
    throw new WatchGuardError("invalid_response", `WatchGuard ${context}: missing data array`);
  }
  const totalItems = typeof envelope.total_items === "number" ? envelope.total_items : null;
  return { data: envelope.data.map((item) => parseItem(itemSchema, item, context)), totalItems };
}

function parseItem<T>(schema: z.ZodType<T>, item: unknown, context: string): T {
  const parsed = schema.safeParse(item);
  if (!parsed.success) {
    // An item in an otherwise-paged list failed to parse — neither zero rows
    // nor silently dropped; mark the stream invalid so callers never treat it
    // as clean evidence.
    throw new WatchGuardError("invalid_response", `WatchGuard ${context}: unexpected item shape`);
  }
  return parsed.data;
}

export function createWatchGuardClient(creds: WatchGuardCredentials, options: WatchGuardClientOptions = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const revision = options.credentialRevision ?? 0;

  function baseUrlFor(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    let url = `https://${regionHost(creds.region)}${path}`;
    if (query) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) parts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
      if (parts.length > 0) url += `?${parts.join("&")}`;
    }
    return url;
  }

  const accountsBase = `/rest/platform/accounts/v2/accounts/${encode(creds.accountId)}`;
  const endpointBase = `/rest/endpoint-security/management/api/v1/accounts/${encode(creds.accountId)}`;
  const threatSyncBase = `/rest/threatsync/management/v1/${encode(creds.accountId)}`;

  // ---- Single GET attempt (no retry; retry lives in performGet) ------------

  async function getJson(url: string, token: string, secrets: WatchGuardSecrets): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "WatchGuard-API-Key": secrets.apiKey ?? "",
          Accept: "application/json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new WatchGuardError("timeout", "WatchGuard request timed out");
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new WatchGuardError("network", `WatchGuard request failed: ${redactWatchGuard(reason, secrets)}`);
    }

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new WatchGuardError("network", "WatchGuard redirect refused");
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), now());
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      const snippet = redactWatchGuard(text, secrets).slice(0, 200);
      throw new WatchGuardError(
        mapHttpStatusToKind(response.status),
        `WatchGuard API responded ${response.status}: ${snippet}`,
        { status: response.status, retryAfterMs },
      );
    }

    if (text.length > MAX_BODY_BYTES) {
      throw new WatchGuardError("invalid_response", "WatchGuard response exceeded 10 MB limit");
    }

    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new WatchGuardError("invalid_response", "WatchGuard returned non-JSON for a JSON endpoint");
    }
  }

  // ---- Read GET with retry + one-token-refresh ----------------------------

  async function performGet<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    parse: (raw: unknown) => T,
  ): Promise<T> {
    const url = baseUrlFor(path, query);
    // Fail-closed transport guard before any network I/O.
    assertWatchGuardRequest("GET", url);

    const key = authCacheKey(creds, revision);
    const tokenOpts = { credentialRevision: revision, fetch: fetchImpl, now };
    let token = (await getToken(creds, tokenOpts)).token;
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await getJson(url, token, { apiKey: creds.apiKey, password: creds.password, accessId: creds.accessId, token });
        return parse(raw);
      } catch (error) {
        const err =
          error instanceof WatchGuardError
            ? error
            : new WatchGuardError("network", redactWatchGuard(String(error), { password: creds.password, token }));
        if (err.kind === "auth" && !refreshed) {
          invalidateToken(key);
          token = (await getToken(creds, tokenOpts)).token;
          refreshed = true;
          continue;
        }
        if (isRetryable(err.kind) && attempt < MAX_RETRIES) {
          const scheduled = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
          const delay = err.retryAfterMs !== null ? Math.min(Math.max(err.retryAfterMs, scheduled), RETRY_AFTER_CAP_MS) : scheduled;
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  /** A blocked write adapter: asserts (rejects) before any fetch. */
  async function blockedWrite<T = never>(method: string, path: string, body?: string): Promise<T> {
    const url = baseUrlFor(path);
    assertWatchGuardRequest(method, url, body);
    // Unreachable — assertWatchGuardRequest rejects every write under lock.
    throw new WatchGuardError("read_only_blocked", "WATCHGUARD_READ_ONLY_BLOCKED");
  }

  return {
    getAccount(): Promise<unknown> {
      return performGet(accountsBase, {}, (raw) => {
        const parsed = accountSchema.safeParse(raw);
        if (!parsed.success) throw new WatchGuardError("invalid_response", "WatchGuard account: unexpected shape");
        return parsed.data;
      });
    },

    // ---- Endpoint Security reads --------------------------------------------

    listDevices(params: { top?: number; skip?: number; count?: boolean } = {}) {
      return performGet(
        `${endpointBase}/devices`,
        { "$top": params.top, "$skip": params.skip, "$count": params.count },
        (raw) => normalizePage(raw, deviceSchema, "devices"),
      );
    },

    listProtectionStatus(params: { top?: number; skip?: number; count?: boolean } = {}) {
      return performGet(
        `${endpointBase}/devicesprotectionstatus`,
        { "$top": params.top, "$skip": params.skip, "$count": params.count },
        (raw) => normalizePage(raw, protectionStatusSchema, "protection status"),
      );
    },

    getLicenses() {
      return performGet(`${endpointBase}/licenses`, {}, (raw) => raw);
    },

    getSecurityEventCounters(mask: number) {
      return performGet(`${endpointBase}/securityeventcounters/${encode(String(mask))}`, {}, (raw) => raw);
    },

    exportSecurityEvents(type: number, period: number, params: { hostname?: string; top?: number; skip?: number } = {}) {
      const path = `${endpointBase}/securityevents/${encode(String(type))}/export/${encode(String(period))}`;
      return performGet(
        path,
        {
          hostname: params.hostname !== undefined ? Buffer.from(params.hostname, "utf8").toString("base64") : undefined,
          top: params.top,
          skip: params.skip,
        },
        (raw) => normalizePage(raw, securityEventSchema, "security events"),
      );
    },

    listUnmanagedDevices(params: { top?: number; skip?: number } = {}) {
      return performGet(`${endpointBase}/unmanageddevices`, { top: params.top, skip: params.skip }, (raw) =>
        normalizePage(raw, unmanagedDeviceSchema, "unmanaged devices"));
    },

    listManagedConfigurations(params: { type?: number } = {}) {
      const path =
        params.type !== undefined
          ? `${endpointBase}/managedconfigurations/${encode(String(params.type))}`
          : `${endpointBase}/managedconfigurations`;
      return performGet(path, {}, (raw) => normalizePage(raw, managedConfigurationSchema, "managed configurations"));
    },

    listTasks(params: { top?: number; skip?: number; filter?: string } = {}) {
      return performGet(`${endpointBase}/tasks`, { top: params.top, skip: params.skip, filter: params.filter }, (raw) =>
        normalizePage(raw, taskSchema, "tasks"));
    },

    getTaskDetails(type: number, taskId: string) {
      return performGet(`${endpointBase}/taskdetails/${encode(String(type))}/${encode(taskId)}`, {}, (raw) => raw);
    },

    listTaskJobs(type: number, taskId: string) {
      return performGet(`${endpointBase}/tasks/${encode(String(type))}/${encode(taskId)}/jobs`, {}, (raw) => raw);
    },

    getTaskJobStatus(type: number, taskId: string, jobId: string, params: { top?: number; skip?: number } = {}) {
      return performGet(
        `${endpointBase}/tasks/${encode(String(type))}/${encode(taskId)}/jobs/${encode(jobId)}/status`,
        { top: params.top, skip: params.skip },
        (raw) => normalizePage(raw, taskJobStatusSchema, "task job status"),
      );
    },

    getTaskJobResults(type: number, taskId: string, jobId: string, params: { top?: number; skip?: number } = {}) {
      return performGet(
        `${endpointBase}/tasks/${encode(String(type))}/${encode(taskId)}/jobs/${encode(jobId)}/results`,
        { top: params.top, skip: params.skip },
        (raw) => raw,
      );
    },

    // ---- ThreatSync reads ----------------------------------------------------

    listIncidents(params: {
      limit?: number;
      duration?: string;
      sortBy?: string;
      sortOrder?: string;
      startAfter?: string;
      query?: string;
    } = {}) {
      return performGet(
        `${threatSyncBase}/incidents`,
        {
          limit: params.limit,
          duration: params.duration,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          startAfter: params.startAfter,
          query: params.query,
        },
        (raw): PagedResult<ThreatSyncIncidentRecord> & { startAfter: string | null } => {
          if (raw === null || typeof raw !== "object") {
            throw new WatchGuardError("invalid_response", "WatchGuard incidents: unexpected shape");
          }
          const envelope = raw as { items?: unknown; count?: unknown };
          if (!Array.isArray(envelope.items)) {
            throw new WatchGuardError("invalid_response", "WatchGuard incidents: missing items array");
          }
          const total = typeof envelope.count === "number" ? envelope.count : null;
          const items = envelope.items.map((item) => parseItem(threatSyncIncidentSchema, item, "incidents"));
          const startAfter = items.length > 0 ? String(items[items.length - 1]!.id ?? "") || null : null;
          return { data: items, totalItems: total, startAfter };
        },
      );
    },

    getIncident(id: string, params: { includeActions?: boolean; includeComments?: boolean } = {}) {
      return performGet(
        `${threatSyncBase}/incidents/${encode(id)}`,
        { includeActions: params.includeActions, includeComments: params.includeComments },
        (raw) => {
          const parsed = threatSyncIncidentSchema.safeParse(raw);
          if (!parsed.success) throw new WatchGuardError("invalid_response", "WatchGuard incident: unexpected shape");
          return parsed.data;
        },
      );
    },

    getIncidentAction(id: string, actionId: string) {
      return performGet(`${threatSyncBase}/incidents/${encode(id)}/actions/${encode(actionId)}`, {}, (raw) => {
        const parsed = threatSyncActionSchema.safeParse(raw);
        if (!parsed.success) throw new WatchGuardError("invalid_response", "WatchGuard incident action: unexpected shape");
        return parsed.data;
      });
    },

    // ---- Iterators (paging until exhausted / total reached) ------------------

    async *iterateDevices(params: { pageSize?: number } = {}): AsyncGenerator<DeviceRecord, void, unknown> {
      const top = params.pageSize ?? 1000;
      let skip = 0;
      for (;;) {
        const page = await this.listDevices({ top, skip, count: true });
        for (const item of page.data) yield item;
        if (page.data.length === 0) break;
        if (page.totalItems !== null && skip + page.data.length >= page.totalItems) break;
        skip += page.data.length;
      }
    },

    async *iterateProtectionStatus(params: { pageSize?: number } = {}): AsyncGenerator<ProtectionStatusRecord, void, unknown> {
      const top = params.pageSize ?? 1000;
      let skip = 0;
      for (;;) {
        const page = await this.listProtectionStatus({ top, skip, count: true });
        for (const item of page.data) yield item;
        if (page.data.length === 0) break;
        if (page.totalItems !== null && skip + page.data.length >= page.totalItems) break;
        skip += page.data.length;
      }
    },

    async *iterateSecurityEvents(
      type: number,
      period: number,
      params: { hostname?: string; pageSize?: number } = {},
    ): AsyncGenerator<SecurityEventRecord, void, unknown> {
      const top = params.pageSize ?? 1000;
      let skip = 0;
      for (;;) {
        const page = await this.exportSecurityEvents(type, period, { hostname: params.hostname, top, skip });
        for (const item of page.data) yield item;
        if (page.data.length === 0) break;
        if (page.totalItems !== null && skip + page.data.length >= page.totalItems) break;
        skip += page.data.length;
      }
    },

    async *iterateIncidents(params: {
      limit?: number;
      duration?: string;
      sortBy?: string;
      sortOrder?: string;
      query?: string;
    } = {}): AsyncGenerator<ThreatSyncIncidentRecord, void, unknown> {
      const limit = params.limit ?? 500;
      let startAfter: string | undefined;
      for (;;) {
        const page = await this.listIncidents({ ...params, limit, startAfter });
        for (const item of page.data) yield item;
        if (page.data.length < limit) break;
        if (!page.startAfter || page.startAfter === startAfter) break;
        startAfter = page.startAfter;
      }
    },

    // ---- Blocked writes (read-only transport) ------------------------------

    startImmediateScan(_body: Record<string, unknown>): Promise<never> {
      return blockedWrite("POST", `${endpointBase}/immediatescan`, JSON.stringify(_body));
    },

    rebootDevices(_deviceIds: string[], _countDownType?: number): Promise<never> {
      return blockedWrite("POST", `${endpointBase}/devices/action`, JSON.stringify({ device_ids: _deviceIds, count_down_type: _countDownType }));
    },

    isolateDevices(_body: Record<string, unknown>): Promise<never> {
      return blockedWrite("POST", `${endpointBase}/devices/isolation`, JSON.stringify(_body));
    },

    unisolateDevices(_deviceIds: string[]): Promise<never> {
      return blockedWrite("POST", `${endpointBase}/devices/noisolation`, JSON.stringify({ device_ids: _deviceIds }));
    },

    assignConfiguration(_configId: string, _deviceIds: string[]): Promise<never> {
      return blockedWrite("PATCH", `${endpointBase}/managedconfigurations/2/${encode(_configId)}`, JSON.stringify({ device_ids: _deviceIds }));
    },

    updateIncidentStatus(_id: string, _status: "new" | "read" | "closed", _comment?: string): Promise<never> {
      return blockedWrite("PATCH", `${threatSyncBase}/incidents/${encode(_id)}`, JSON.stringify({ status: _status, comment: _comment }));
    },

    addIncidentComment(_id: string, _text: string): Promise<never> {
      return blockedWrite("POST", `${threatSyncBase}/incidents/${encode(_id)}/comments`, JSON.stringify({ text: _text }));
    },

    performIncidentAction(
      _id: string,
      _command: { command: string; entityId?: string; parameters?: Record<string, unknown> },
    ): Promise<never> {
      return blockedWrite("POST", `${threatSyncBase}/incidents/${encode(_id)}/actions`, JSON.stringify(_command));
    },
  };
}

export type WatchGuardClient = ReturnType<typeof createWatchGuardClient>;