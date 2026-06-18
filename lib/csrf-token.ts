import "server-only";

/**
 * Generate a random CSRF token. Stored in a non-httpOnly cookie so the
 * client-side JavaScript can read it and include it in a hidden form
 * field or X-CSRF-Token header.
 *
 * This file used to import `node:crypto.randomBytes`, which broke the
 * Edge runtime bundle as soon as lib/session.ts (which imports
 * generateCsrfToken) got pulled into the middleware module graph via
 * decrypt(). Web Crypto's getRandomValues works in both Node and the
 * Edge runtime, so we use that instead.
 */
export function generateCsrfToken(): string {
  // 32 random bytes -> 64 hex chars. getRandomValues is available in
  // Node 19+, every modern browser, and the Next.js Edge runtime.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
