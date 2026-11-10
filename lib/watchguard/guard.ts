/**
 * WatchGuard read-only outbound transport guard.
 *
 * This is the single private boundary every real provider call must cross:
 * the API client (GETs) and the auth module (the OAuth token POST) both call
 * {@link assertWatchGuardRequest} before any network I/O. It implements
 * READ_ONLY_SAFEGUARD.md and there is no `allowWrites` switch, no env/unlock,
 * and no runtime path that mutates the WatchGuard server.
 *
 * Allowed requests:
 *   1. Fixed HTTPS regional host, standard port, no userinfo/fragment/redirect,
 *      no path-normalization tricks.
 *   2. Explicit documented read operations (exact route templates below).
 *   3. The sole POST: `/oauth/token` with form
 *      `grant_type=client_credentials&scope=api-access` and Basic auth.
 *
 * Everything else (POST/PATCH/PUT/DELETE/unknown GET/methods) is rejected with
 * `WATCHGUARD_READ_ONLY_BLOCKED` **before** a connection is opened.
 */
import { WatchGuardError } from "./errors";
import { WATCHGUARD_REGIONS } from "./regions";

export const READ_ONLY_BLOCKED = "WATCHGUARD_READ_ONLY_BLOCKED";

const ALLOWED_HOSTS = new Set<string>(Object.values(WATCHGUARD_REGIONS));

const TOKEN_PATH = "/oauth/token";

/** Exact route templates for read-only GETs. `{param}` segments are single
 * path segments validated against a no-traversal charset below. */
const ALLOWED_GET_ROUTES: readonly string[] = [
  // Platform accounts
  "/rest/platform/accounts/v2/accounts/{accountId}",
  // Endpoint Security management
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/devices",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/devicesprotectionstatus",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/unmanageddevices",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/licenses",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/securityeventcounters/{type}",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/securityevents/{type}/export/{period}",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/securityoverview/{period}",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/managedconfigurations/{type}",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/tasks",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/taskdetails/{type}/{taskId}",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/tasks/{type}/{taskId}/jobs",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/tasks/{type}/{taskId}/jobs/{jobId}/status",
  "/rest/endpoint-security/management/api/v1/accounts/{accountId}/tasks/{type}/{taskId}/jobs/{jobId}/results",
  // ThreatSync management
  "/rest/threatsync/management/v1/{accountId}/incidents",
  "/rest/threatsync/management/v1/{accountId}/incidents/{id}",
  "/rest/threatsync/management/v1/{accountId}/incidents/{id}/comments",
  "/rest/threatsync/management/v1/{accountId}/incidents/{id}/actions",
  "/rest/threatsync/management/v1/{accountId}/incidents/{id}/actions/{actionId}",
  "/rest/threatsync/management/v1/{accountId}/actions",
  "/rest/threatsync/management/v1/{accountId}/actions/{actionId}",
];

const PARAM_CHARSET = /^[A-Za-z0-9._~-]+$/;

/** Match a pathname against a template with `{param}` segments. */
function matchRouteTemplate(pathname: string, template: string): boolean {
  const pathSegs = pathname.split("/").filter((s) => s.length > 0);
  const tplSegs = template.split("/").filter((s) => s.length > 0);
  if (pathSegs.length !== tplSegs.length) return false;
  for (let i = 0; i < tplSegs.length; i++) {
    const t = tplSegs[i]!;
    const actual = pathSegs[i]!;
    if (t.startsWith("{") && t.endsWith("}")) {
      if (!PARAM_CHARSET.test(actual)) return false;
    } else if (t !== actual) {
      return false;
    }
  }
  return true;
}

/** Validate the OAuth token POST form body exactly. */
function isExactTokenForm(body: string): boolean {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return false;
  }
  const entries = [...params.entries()];
  if (entries.length !== 2) return false;
  if (params.get("grant_type") !== "client_credentials") return false;
  if (params.get("scope") !== "api-access") return false;
  // Exactly the two required keys, each present once (no duplicates/extra).
  if (params.getAll("grant_type").length !== 1 || params.getAll("scope").length !== 1) return false;
  return true;
}

export type OutboundMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type GuardClassification =
  | { allowed: true; method: "GET" | "POST"; url: URL; path: string }
  | { allowed: false; reason: string };

/**
 * Classify an outbound request without performing network I/O. Pure and
 * deterministic: same input always yields the same classification.
 */
export function classifyOutbound(
  method: string,
  rawUrl: string,
  body?: string | null,
): GuardClassification {
  const methodUpper = method.toUpperCase();

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "malformed URL" };
  }

  if (url.protocol !== "https:") return { allowed: false, reason: "must be HTTPS" };
  if (!ALLOWED_HOSTS.has(url.hostname)) return { allowed: false, reason: "host not allowlisted" };
  if (url.port !== "") return { allowed: false, reason: "non-standard port" };
  if (url.username !== "" || url.password !== "") return { allowed: false, reason: "URL userinfo" };
  if (url.hash !== "") return { allowed: false, reason: "URL fragment" };

  // Reject encoded traversal / separator tricks before matching routes.
  const pathname = url.pathname;
  if (pathname.includes("\\")) return { allowed: false, reason: "backslash in path" };
  if (pathname.includes("..")) return { allowed: false, reason: "dot-dot in path" };
  if (/%2f|%5c|%2e/i.test(pathname)) return { allowed: false, reason: "encoded path traversal" };

  if (methodUpper === "GET") {
    const ok = ALLOWED_GET_ROUTES.some((template) => matchRouteTemplate(pathname, template));
    return ok
      ? { allowed: true, method: "GET", url, path: pathname }
      : { allowed: false, reason: "GET not in read allowlist" };
  }

  if (methodUpper === "POST" && pathname === TOKEN_PATH) {
    // No business payload is ever permitted on the token endpoint.
    const bodyStr = typeof body === "string" ? body : "";
    if (!isExactTokenForm(bodyStr)) {
      return { allowed: false, reason: "token form must be exactly grant_type=client_credentials&scope=api-access" };
    }
    return { allowed: true, method: "POST", url, path: pathname };
  }

  return { allowed: false, reason: `method ${methodUpper} not permitted under read-only` };
}

/**
 * Assert a request against the read-only guard. On rejection throws a typed
 * `WATCHGUARD_READ_ONLY_BLOCKED` error before any network I/O.
 */
export function assertWatchGuardRequest(
  method: string,
  rawUrl: string,
  body?: string | null,
): { url: URL; path: string } {
  const result = classifyOutbound(method, rawUrl, body);
  if (!result.allowed) {
    throw new WatchGuardError("read_only_blocked", `${READ_ONLY_BLOCKED}: ${result.reason}`);
  }
  return { url: result.url, path: result.path };
}