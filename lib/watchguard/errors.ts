/**
 * Typed WatchGuard API errors + credential redaction.
 *
 * Every error message that can be surfaced to an operator or stored in a log
 * passes through `redactWatchGuard` so a credential, token or API key can
 * never leak through a provider error body. `kind` drives retry/refresh logic
 * in the client; the read-only transport guard emits `read_only_blocked`.
 */

export type WatchGuardErrorKind =
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "invalid_response"
  | "read_only_blocked";

/** Secrets that must never appear in a returned message. All optional. */
export type WatchGuardSecrets = {
  accessId?: string;
  password?: string;
  apiKey?: string;
  token?: string;
};

export class WatchGuardError extends Error {
  override readonly name = "WatchGuardError";
  readonly kind: WatchGuardErrorKind;
  /** HTTP status when the error came from the provider, else `null`. */
  readonly status: number | null;
  /**
   * True when a write reached the network and its outcome is unknown
   * (timeout/network with no clear provider answer). Under the read-only lock
   * writes never reach the network, so this only matters for future write
   * adapters. Always false for `read_only_blocked`.
   */
  readonly outcomeUnknown: boolean;
  /** Parsed `Retry-After` delay in ms, when the provider supplied one. */
  readonly retryAfterMs: number | null;

  constructor(
    kind: WatchGuardErrorKind,
    message: string,
    options: { status?: number | null; outcomeUnknown?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.kind = kind;
    this.status = options.status ?? null;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/**
 * Remove known credential values and Authorization/token header values from
 * arbitrary text (usually a provider error body). Values are only redacted
 * when non-empty, so placeholder/empty secrets are no-ops. Also strips the
 * generic `Authorization: (Bearer|Basic) …` and `<token-name>=<value>` shapes
 * in case a secret leaks in a form this helper does not know about.
 */
export function redactWatchGuard(text: string, secrets: WatchGuardSecrets): string {
  if (!text) return text;

  let out = text;

  const values = [secrets.token, secrets.password, secrets.apiKey, secrets.accessId]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .sort((a, b) => b.length - a.length);

  for (const value of values) {
    out = out.split(value).join("[REDACTED]");
  }

  out = out
    // Authorization: Bearer <token> / Basic <base64> in any capitalization.
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"']+/gi, "$1[REDACTED]")
    // `"access_token": "<value>"` (JSON-quoted form).
    .replace(/("(?:access_token|refresh_token|id_token|token|password|api[_-]?key|apikey)"\s*:\s*")([^"]*)(")/gi, "$1[REDACTED]$3")
    // `access_token=<value>` / `token: <value>` (unquoted form).
    .replace(/(\b(?:access_token|refresh_token|id_token|token|password|api[_-]?key|apikey)\s*[:=]\s*)[^\s,;"']+/gi, "$1[REDACTED]");

  return out;
}

/** Map a provider HTTP status to a typed `WatchGuardErrorKind`. */
export function mapHttpStatusToKind(status: number): WatchGuardErrorKind {
  // WatchGuard reports invalid credentials as both 400 and 401; treat both as
  // auth so the client refreshes/invalidates appropriately.
  if (status === 400 || status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "invalid_response";
}