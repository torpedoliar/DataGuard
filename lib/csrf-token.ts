import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Generate a random CSRF token. Stored in a non-httpOnly cookie so the
 * client-side JavaScript can read it and include it in a hidden form
 * field or X-CSRF-Token header.
 *
 * This is in its own file (separate from the runtime-agnostic helpers
 * in lib/csrf.ts) because it depends on `node:crypto.randomBytes` which
 * is not available in the Next.js Edge runtime.
 */
export function generateCsrfToken(): string {
  // 32 random bytes -> 64 hex chars
  return randomBytes(32).toString("hex");
}
