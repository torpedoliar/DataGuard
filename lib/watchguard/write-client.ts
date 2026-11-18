/**
 * WatchGuard write transport (single attempt, no retry).
 *
 * This module performs exactly one HTTP request for a registered write
 * operation and returns raw transport facts. It deliberately does not decide
 * whether the outcome was a success: `lib/epdr/execution-dispatch.ts` classifies
 * the facts, because a timeout, a 5xx, or a 2xx without the documented receipt
 * field are all *ambiguous* and must never be retried.
 *
 * Reads keep their retry/refresh behaviour in `client.ts`. A write is never
 * retried here, and a failed token exchange is reported as `definite_reject`
 * because the provider request was never sent.
 */
import type { WriteOperation } from "@/lib/epdr/execution-capability";
import { authCacheKey, getToken, invalidateToken } from "./auth";
import { redactWatchGuard, type WatchGuardSecrets } from "./errors";
import { regionHost, type WatchGuardRegion } from "./regions";
import type { WatchGuardCredentials } from "./types";
import { resolveWriteTarget, type WriteGuardBlockReason } from "./write-guard";

const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1_000_000;

/** Raw facts about one write attempt. Classification happens in the EPDR layer. */
export type WriteTransportResult =
  | {
      kind: "sent";
      status: number;
      body: unknown;
      /** Redacted provider text, bounded, for audit only. */
      snippet: string;
    }
  | { kind: "timed_out" }
  | { kind: "network_error"; message: string }
  | { kind: "blocked"; reason: WriteGuardBlockReason | "token_exchange_failed" };

export type WriteTransportInput = {
  credentials: WatchGuardCredentials;
  operation: WriteOperation;
  pathParams?: Record<string, string>;
  body: Record<string, unknown>;
  /** Enablement resolved from storage. Must be explicitly true. */
  enabled: boolean;
  /** Pair actually loaded; a read pair is refused. */
  credentialMode: "read" | "write";
  credentialRevision?: number;
};

export type WriteTransportDeps = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type WatchGuardWriteTransport = {
  send(input: WriteTransportInput): Promise<WriteTransportResult>;
};

/**
 * Build the write transport. `fetch` is injectable so contract tests exercise
 * the allowlist and the single-attempt rule with zero network access.
 */
export function createWatchGuardWriteTransport(deps: WriteTransportDeps = {}): WatchGuardWriteTransport {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  return {
    async send(input) {
      const target = resolveWriteTarget({
        operation: input.operation,
        accountId: input.credentials.accountId,
        region: input.credentials.region,
        pathParams: input.pathParams,
        credentialMode: input.credentialMode,
        enabled: input.enabled,
      });
      if (!target.ok) return { kind: "blocked", reason: target.reason };

      const secrets: WatchGuardSecrets = {
        apiKey: input.credentials.apiKey,
        password: input.credentials.password,
        accessId: input.credentials.accessId,
      };

      let token: string;
      try {
        const result = await getToken(input.credentials, {
          credentialRevision: input.credentialRevision ?? 0,
          fetch: fetchImpl,
        });
        token = result.token;
      } catch {
        // No provider request was made, so nothing can have been executed and
        // the outcome is not ambiguous.
        return { kind: "blocked", reason: "token_exchange_failed" };
      }

      let response: Response;
      try {
        response = await fetchImpl(target.url, {
          method: target.method,
          headers: {
            Authorization: `Bearer ${token}`,
            "WatchGuard-API-Key": input.credentials.apiKey ?? "",
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input.body),
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === "TimeoutError" || name === "AbortError") return { kind: "timed_out" };
        const reason = error instanceof Error ? error.message : String(error);
        return { kind: "network_error", message: redactWatchGuard(reason, { ...secrets, token }) };
      }

      if (response.type === "opaqueredirect") {
        // A redirect leaves the documented endpoint; the outcome is ambiguous.
        return { kind: "sent", status: 302, body: null, snippet: "redirect_refused" };
      }

      const text = await response.text().catch(() => "");
      if (text.length > MAX_BODY_BYTES) {
        return { kind: "sent", status: response.status, body: null, snippet: "response_too_large" };
      }
      const snippet = redactWatchGuard(text, { ...secrets, token }).slice(0, 200);
      let body: unknown = null;
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      return { kind: "sent", status: response.status, body, snippet };
    },
  };
}

/** Token cache key for the exact credential pair used by a write attempt. */
export function writeTokenKey(credentials: WatchGuardCredentials, credentialRevision: number): string {
  return authCacheKey(credentials, credentialRevision);
}

/** Invalidate a cached token after an auth rejection so the next attempt re-authenticates. */
export function invalidateWriteToken(credentials: WatchGuardCredentials, credentialRevision: number): void {
  invalidateToken(authCacheKey(credentials, credentialRevision));
}

/** Host for a region; exported so the dispatcher can record the exact target host. */
export function writeHost(region: WatchGuardRegion): string {
  return regionHost(region);
}
