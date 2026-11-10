import type { WatchGuardRegion } from "./regions";

/**
 * WatchGuard API credentials for one site connection.
 *
 * `accessId` + `password` authenticate to the OAuth token endpoint; `apiKey`
 * is the WatchGuard-API-Key sent as a request header. Both must remain
 * server-side only — never return them to the client, and redact them from
 * every error/audit message (see `redactWatchGuard` in `errors.ts`).
 */
export type WatchGuardCredentials = {
  region: WatchGuardRegion;
  accountId: string;
  accessId: string;
  password: string;
  apiKey: string;
};

/** Result of a successful OAuth client-credentials exchange. */
export type TokenResult = {
  token: string;
  /** Epoch milliseconds at which the token expires. */
  expiresAt: number;
};

/**
 * Normalized page shape returned by list endpoints. The provider can answer a
 * bare array or a `{ data: [...], total_items: n }` envelope; both normalize
 * to this shape at the client boundary (CONTRACTS C4).
 */
export type PagedResult<T> = {
  data: T[];
  /** `null` when the provider did not report a total (never treated as zero). */
  totalItems: number | null;
};

/** Result of a mutating operation that must remain blocked under read-only. */
export type BlockedWriteResult = never;