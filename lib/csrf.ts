/**
 * Constant-time byte comparison. Edge-runtime safe — no node:crypto
 * dependency, so it can be bundled into the Next.js middleware.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Verify a CSRF token from the request against the cookie value using a
 * constant-time comparison. Returns true if the tokens match.
 *
 * Edge-runtime safe: uses TextEncoder + a hand-rolled constant-time loop
 * instead of node:crypto.timingSafeEqual, which is not available in the
 * Next.js Edge runtime. Middleware imports this module, so it must stay
 * Edge-bundleable.
 */
export function verifyCsrfToken(
  cookieToken: string | undefined,
  requestToken: string | undefined,
): boolean {
  if (!cookieToken || !requestToken) return false;
  if (cookieToken.length !== requestToken.length) return false;
  try {
    const a = new TextEncoder().encode(cookieToken);
    const b = new TextEncoder().encode(requestToken);
    return constantTimeEqual(a, b);
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
