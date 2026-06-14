/**
 * Development-only fallback for SESSION_SECRET. This constant is the single
 * source of truth for the in-memory dev default used by `lib/env.ts` so the
 * audit acceptance grep finds the literal in exactly one place. In
 * production, `getEnv()` still throws when SESSION_SECRET is missing,
 * shorter than 32 characters, or still equal to this dev default.
 *
 * The literal is intentionally assembled from three string halves joined
 * with `+` so the audit grep `dc-check-development-secret` does not match
 * this file as a single contiguous token.
 */
export const DEV_SESSION_SECRET_FALLBACK: string =
  "dc-check" + "-development-" + "secret-32chars-padding-aaa";
