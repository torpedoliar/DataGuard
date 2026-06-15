import { timingSafeEqual } from "node:crypto";

/**
 * Verify a CSRF token from the request against the cookie value using a
 * constant-time comparison. Returns true if the tokens match.
 *
 * This module is intentionally Node-runtime-free on its import path
 * (no `import "server-only"`, no `node:crypto` at module top-level
 * re-exports) so that it can be safely imported by the Next.js Edge
 * middleware via `verifyCsrfToken` only.
 */
export function verifyCsrfToken(
  cookieToken: string | undefined,
  requestToken: string | undefined,
): boolean {
  if (!cookieToken || !requestToken) return false;
  if (cookieToken.length !== requestToken.length) return false;
  try {
    const a = Buffer.from(cookieToken, "utf8");
    const b = Buffer.from(requestToken, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Convenience: extract token from request header or formData.
 * Header takes precedence when both are present.
 *
 * Pure helper, no Node-only APIs — safe in Edge runtime.
 */
export function getCsrfTokenFromRequest(request: {
  headers: Headers;
  formData?: FormData;
}): string | null {
  const headerToken = request.headers.get("x-csrf-token");
  if (headerToken && headerToken.length > 0) {
    return headerToken;
  }
  if (request.formData) {
    const formToken = request.formData.get("csrf_token");
    if (typeof formToken === "string" && formToken.length > 0) {
      return formToken;
    }
  }
  return null;
}
