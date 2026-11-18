/**
 * WatchGuard write-transport guard.
 *
 * This is a *separate* boundary from the read-only guard in `guard.ts`. It
 * never accepts a URL, a method, or a free-form path from a caller: the caller
 * passes a registered {@link WriteOperation} from
 * `lib/epdr/execution-capability.ts`, and this module derives the exact method,
 * host, and path itself.
 *
 * Four independent conditions must all hold, and every one of them is explicit:
 *   1. the operation exists in the verified write registry;
 *   2. the caller passed `enabled: true` (deployment/site/action enablement
 *      resolved from storage — never an environment variable);
 *   3. the resolved credentials are the RW pair, never the RO pair;
 *   4. the derived path matches the registered template segment-for-segment.
 *
 * There is no wildcard route, no prefix match, no batch endpoint, and no
 * arbitrary-executor fallback. Pure: no network, no DB, no credentials stored.
 */
import { getWriteOperation, type WriteOperation } from "@/lib/epdr/execution-capability";
import { WATCHGUARD_REGIONS, isWatchGuardRegion, regionHost, type WatchGuardRegion } from "./regions";

export type WriteGuardBlockReason =
  | "write_disabled"
  | "read_credentials"
  | "operation_not_registered"
  | "invalid_account"
  | "unknown_region"
  | "missing_path_parameter"
  | "invalid_path_parameter"
  | "path_mismatch"
  | "host_not_allowlisted";

export type WriteGuardClassification =
  | { allowed: true; method: "POST" | "PATCH"; url: URL; path: string; operation: WriteOperation }
  | { allowed: false; reason: WriteGuardBlockReason };

export type WriteGuardInput = {
  operation: WriteOperation;
  accountId: string;
  region: string;
  /** Values for `{placeholder}` segments in the operation path. */
  pathParams?: Record<string, string>;
  /** Credential pair actually loaded. A read pair can never authorize a write. */
  credentialMode: "read" | "write";
  /** Enablement resolved from storage. Defaults to false everywhere. */
  enabled: boolean;
};

const ACCOUNT_CHARSET = /^[A-Za-z0-9._~-]{1,128}$/;
const PARAM_CHARSET = /^[A-Za-z0-9._~-]{1,128}$/;
const ALLOWED_HOSTS = new Set<string>(Object.values(WATCHGUARD_REGIONS));

const NAMESPACE_PREFIX: Record<WriteOperation["namespace"], string> = {
  endpoint_security: "/rest/endpoint-security/management/api/v1/accounts",
  threatsync: "/rest/threatsync/management/v1",
};

/** Resolve the registered path template into a concrete path. */
function resolvePath(
  operation: WriteOperation,
  accountId: string,
  params: Record<string, string>,
): { ok: true; path: string } | { ok: false; reason: WriteGuardBlockReason } {
  const prefix = `${NAMESPACE_PREFIX[operation.namespace]}/${accountId}`;
  const segments = operation.path.split("/").filter((segment) => segment.length > 0);
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const key = segment.slice(1, -1);
      const value = params[key];
      if (value === undefined || value.length === 0) return { ok: false, reason: "missing_path_parameter" };
      if (!PARAM_CHARSET.test(value)) return { ok: false, reason: "invalid_path_parameter" };
      resolved.push(value);
    } else {
      resolved.push(segment);
    }
  }
  return { ok: true, path: `${prefix}/${resolved.join("/")}` };
}

/** Re-derive the template from a concrete path and require an exact match. */
function pathMatchesTemplate(path: string, operation: WriteOperation, accountId: string): boolean {
  const prefix = `${NAMESPACE_PREFIX[operation.namespace]}/${accountId}/`;
  if (!path.startsWith(prefix)) return false;
  const actual = path.slice(prefix.length).split("/");
  const template = operation.path.split("/").filter((segment) => segment.length > 0);
  if (actual.length !== template.length) return false;
  return template.every((segment, index) => {
    const value = actual[index]!;
    if (segment.startsWith("{") && segment.endsWith("}")) return PARAM_CHARSET.test(value);
    return segment === value;
  });
}

export function classifyWriteOutbound(input: WriteGuardInput): WriteGuardClassification {
  if (!input.enabled) return { allowed: false, reason: "write_disabled" };
  if (input.credentialMode !== "write") return { allowed: false, reason: "read_credentials" };

  // Identity check: the operation object must be one this build registered.
  const registered = getWriteOperation(input.operation?.namespace, input.operation?.actionType);
  if (!registered) return { allowed: false, reason: "operation_not_registered" };
  if (registered.method !== input.operation.method || registered.path !== input.operation.path) {
    return { allowed: false, reason: "operation_not_registered" };
  }

  if (typeof input.accountId !== "string" || !ACCOUNT_CHARSET.test(input.accountId)) {
    return { allowed: false, reason: "invalid_account" };
  }
  if (!isWatchGuardRegion(input.region)) return { allowed: false, reason: "unknown_region" };

  const resolved = resolvePath(registered, input.accountId, input.pathParams ?? {});
  if (!resolved.ok) return { allowed: false, reason: resolved.reason };

  if (!pathMatchesTemplate(resolved.path, registered, input.accountId)) {
    return { allowed: false, reason: "path_mismatch" };
  }
  if (resolved.path.includes("..") || /%2f|%5c|%2e/i.test(resolved.path) || resolved.path.includes("\\")) {
    return { allowed: false, reason: "path_mismatch" };
  }

  const host = regionHost(input.region as WatchGuardRegion);
  if (!ALLOWED_HOSTS.has(host)) return { allowed: false, reason: "host_not_allowlisted" };

  let url: URL;
  try {
    url = new URL(`https://${host}${resolved.path}`);
  } catch {
    return { allowed: false, reason: "path_mismatch" };
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "" || url.hash !== "") {
    return { allowed: false, reason: "host_not_allowlisted" };
  }
  if (url.search !== "") return { allowed: false, reason: "path_mismatch" };

  return { allowed: true, method: registered.method, url, path: resolved.path, operation: registered };
}

export type WriteDispatchTarget =
  | { ok: true; method: "POST" | "PATCH"; url: string; path: string; operation: WriteOperation }
  | { ok: false; reason: WriteGuardBlockReason };

/** Convenience wrapper returning the dispatchable URL or a typed block reason. */
export function resolveWriteTarget(input: WriteGuardInput): WriteDispatchTarget {
  const classified = classifyWriteOutbound(input);
  return classified.allowed
    ? { ok: true, method: classified.method, url: classified.url.toString(), path: classified.path, operation: classified.operation }
    : { ok: false, reason: classified.reason };
}
