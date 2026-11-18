/**
 * Resolve a site's WatchGuard connection into usable credentials and run a
 * per-service connection test. Reads prefer RO credentials and fall back to
 * RW; writes require RW. A disabled connection is not usable for background
 * jobs but can still be resolved for one-off diagnosis (the settings "Test
 * connection" button), matching the NCM "test a draft without enabling it"
 * behaviour.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { watchguardConnections } from "@/db/schema";
import { decryptString } from "../crypto";
import { isWatchGuardRegion, type WatchGuardRegion } from "./regions";
import type { WatchGuardCredentials } from "./types";
import { getToken } from "./auth";
import { createWatchGuardClient, type WatchGuardClientOptions } from "./client";
import { WatchGuardError } from "./errors";

export type ConnectionMode = "read" | "write";

export type WatchGuardConnectionRow = {
  id: number;
  siteId: number;
  enabled: boolean;
  region: string | null;
  accountId: string | null;
  apiKey: string | null;
  rwAccessId: string | null;
  rwPassword: string | null;
  roAccessId: string | null;
  roPassword: string | null;
  credentialRevision: number;
  accountRevision: number;
};

export type CredentialSource = "ro" | "rw";
export type ResolveReason = "not_configured" | "disabled" | "missing_write_credentials" | "unknown_region" | "partial_read_credentials";

export type ResolvedConnection =
  | {
      ok: true;
      credentials: WatchGuardCredentials;
      credentialSource?: CredentialSource;
      credentialRevision: number;
      accountRevision: number;
      region: WatchGuardRegion;
      accountId: string;
    }
  | { ok: false; reason: ResolveReason };

export type ResolveDeps = {
  getRow(siteId: number): Promise<WatchGuardConnectionRow | null>;
};

export const resolveDeps: ResolveDeps = {
  async getRow(siteId) {
    const rows = await db
      .select({
        id: watchguardConnections.id,
        siteId: watchguardConnections.siteId,
        enabled: watchguardConnections.enabled,
        region: watchguardConnections.region,
        accountId: watchguardConnections.accountId,
        apiKey: watchguardConnections.apiKey,
        rwAccessId: watchguardConnections.rwAccessId,
        rwPassword: watchguardConnections.rwPassword,
        roAccessId: watchguardConnections.roAccessId,
        roPassword: watchguardConnections.roPassword,
        credentialRevision: watchguardConnections.credentialRevision,
        accountRevision: watchguardConnections.accountRevision,
      })
      .from(watchguardConnections)
      .where(eq(watchguardConnections.siteId, siteId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      region: row.region ?? null,
      accountId: row.accountId ?? null,
    };
  },
};

export async function resolveWatchGuardConnection(
  siteId: number,
  options: { mode?: ConnectionMode; allowDisabled?: boolean; deps?: ResolveDeps } = {},
): Promise<ResolvedConnection> {
  const mode = options.mode ?? "read";
  const deps = options.deps ?? resolveDeps;

  const row = await deps.getRow(siteId);
  if (!row) return { ok: false, reason: "not_configured" };
  if (!row.enabled && !options.allowDisabled) return { ok: false, reason: "disabled" };
  if (!row.region || !isWatchGuardRegion(row.region)) return { ok: false, reason: "unknown_region" };

  const hasRoId = Boolean(row.roAccessId);
  const hasRoPassword = Boolean(row.roPassword);
  if (mode === "read" && hasRoId !== hasRoPassword) {
    return { ok: false, reason: "partial_read_credentials" };
  }
  const credentialSource: CredentialSource = mode === "read" && hasRoId && hasRoPassword ? "ro" : "rw";
  const accessId = credentialSource === "ro" ? row.roAccessId : row.rwAccessId;
  const passwordCipher = credentialSource === "ro" ? row.roPassword : row.rwPassword;

  if (!row.accountId || !accessId || !passwordCipher) {
    return { ok: false, reason: mode === "write" ? "missing_write_credentials" : "not_configured" };
  }

  let password: string;
  let apiKey = "";
  try {
    password = decryptString(passwordCipher);
    if (row.apiKey) apiKey = decryptString(row.apiKey);
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  return {
    ok: true,
    credentialSource,
    region: row.region,
    accountId: row.accountId,
    credentialRevision: row.credentialRevision,
    accountRevision: row.accountRevision,
    credentials: { region: row.region, accountId: row.accountId, accessId, password, apiKey },
  };
}

// ---- Connection test -------------------------------------------------------

export type ServiceTest = {
  ok: boolean; status: number | null; kind: string | null; message: string;
  stage?: "oauth" | "rest" | "resolve";
  skipped?: boolean;
};
export type ServiceChecks = { auth: ServiceTest; account: ServiceTest; endpointSecurity: ServiceTest; threatSync: ServiceTest };

export type CheckTarget = {
  getToken(): Promise<unknown>;
  getAccount(): Promise<unknown>;
  getLicenses(): Promise<unknown>;
  listIncidents(): Promise<unknown>;
};

async function toServiceTest(check: () => Promise<unknown>, stage: "oauth" | "rest"): Promise<ServiceTest> {
  try {
    await check();
    return { ok: true, status: 200, kind: null, message: "OK", stage };
  } catch (error) {
    // Provider bodies and arbitrary exception messages are not safe UI output.
    const status = error instanceof WatchGuardError ? error.status : null;
    const kind = error instanceof WatchGuardError ? error.kind : "network";
    return { ok: false, status, kind, stage, message: `${stage === "oauth" ? "OAuth" : "REST"} check failed${status !== null ? ` (HTTP ${status})` : ""}.` };
  }
}

/** Authenticate first; only independent REST probes run concurrently. */
export async function runServiceChecks(target: CheckTarget): Promise<ServiceChecks> {
  const auth = await toServiceTest(() => target.getToken(), "oauth");
  if (!auth.ok) {
    const skipped: ServiceTest = {
      ok: false, status: null, kind: auth.kind, stage: "rest", skipped: true,
      message: "REST check skipped because OAuth authentication failed.",
    };
    return { auth, account: { ...skipped }, endpointSecurity: { ...skipped }, threatSync: { ...skipped } };
  }
  const [account, endpointSecurity, threatSync] = await Promise.all([
    toServiceTest(() => target.getAccount(), "rest"),
    toServiceTest(() => target.getLicenses(), "rest"),
    toServiceTest(() => target.listIncidents(), "rest"),
  ]);
  return { auth, account, endpointSecurity, threatSync };
}

export type ConnectionTestMetadata = {
  credentialSources?: { read?: CredentialSource; write?: CredentialSource };
  unresolved?: { read?: ResolveReason; write?: ResolveReason };
};
export type ConnectionTestResult = ConnectionTestMetadata & (
  | { configured: false; reason: ResolveReason }
  | { configured: true; read?: ServiceChecks; write?: ServiceChecks }
);

export type ConnectionTestDeps = {
  resolve(siteId: number, options: { mode: ConnectionMode; allowDisabled: true }): Promise<ResolvedConnection>;
  buildClient(credentials: WatchGuardCredentials, options: WatchGuardClientOptions): ReturnType<typeof createWatchGuardClient>;
  checkTarget(credentials: WatchGuardCredentials, options: WatchGuardClientOptions): CheckTarget;
};

export const connectionTestDeps: ConnectionTestDeps = {
  resolve: (siteId, options) => resolveWatchGuardConnection(siteId, options),
  buildClient: createWatchGuardClient,
  checkTarget(credentials, options) {
    const client = createWatchGuardClient(credentials, options);
    return {
      getToken: () => getToken(credentials, options),
      getAccount: () => client.getAccount(),
      getLicenses: () => client.getLicenses(),
      listIncidents: () => client.listIncidents({ limit: 1 }),
    };
  },
};

export async function testConnection(
  siteId: number,
  deps: ConnectionTestDeps = connectionTestDeps,
): Promise<ConnectionTestResult> {
  const read = await deps.resolve(siteId, { mode: "read", allowDisabled: true });
  const write = await deps.resolve(siteId, { mode: "write", allowDisabled: true });

  const unresolved: NonNullable<ConnectionTestMetadata["unresolved"]> = {};
  if (!read.ok) unresolved.read = read.reason;
  if (!write.ok) unresolved.write = write.reason;
  if (!read.ok && !write.ok) {
    return { configured: false, reason: read.reason, unresolved };
  }

  const result: ConnectionTestResult = { configured: true, credentialSources: {}, unresolved };
  function unresolvedChecks(reason: ResolveReason): ServiceChecks {
    const check: ServiceTest = { ok: false, status: null, kind: "unresolved", message: `Credentials unresolved: ${reason}.`, stage: "resolve", skipped: true };
    return { auth: { ...check }, account: { ...check }, endpointSecurity: { ...check }, threatSync: { ...check } };
  }
  async function checks(resolved: ResolvedConnection): Promise<ServiceChecks> {
    if (!resolved.ok) return unresolvedChecks(resolved.reason);
    // A new scope guarantees fresh OAuth without disturbing worker tokens.
    return runServiceChecks(deps.checkTarget(resolved.credentials, {
      credentialRevision: resolved.credentialRevision, cacheScope: {},
    }));
  }
  result.read = await checks(read);
  if (read.ok && read.credentialSource) result.credentialSources!.read = read.credentialSource;
  if (write.ok && write.credentialSource) result.credentialSources!.write = write.credentialSource;
  const sameCredentials = read.ok && write.ok
    && read.credentialRevision === write.credentialRevision
    && read.credentials.region === write.credentials.region
    && read.credentials.accountId === write.credentials.accountId
    && read.credentials.accessId === write.credentials.accessId
    && read.credentials.password === write.credentials.password
    && read.credentials.apiKey === write.credentials.apiKey;
  result.write = sameCredentials ? result.read : await checks(write);
  return result;
}