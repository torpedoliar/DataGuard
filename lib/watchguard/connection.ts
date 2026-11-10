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

export type ResolveReason = "not_configured" | "disabled" | "missing_write_credentials" | "unknown_region";

export type ResolvedConnection =
  | {
      ok: true;
      credentials: WatchGuardCredentials;
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

  const accessId = mode === "write" ? row.rwAccessId : (row.roAccessId ?? row.rwAccessId);
  const passwordCipher = mode === "write" ? row.rwPassword : (row.roPassword ?? row.rwPassword);

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
    region: row.region,
    accountId: row.accountId,
    credentialRevision: row.credentialRevision,
    accountRevision: row.accountRevision,
    credentials: { region: row.region, accountId: row.accountId, accessId, password, apiKey },
  };
}

// ---- Connection test -------------------------------------------------------

export type ServiceTest = { ok: boolean; status: number | null; kind: string | null; message: string };
export type ServiceChecks = { auth: ServiceTest; account: ServiceTest; endpointSecurity: ServiceTest; threatSync: ServiceTest };

export type CheckTarget = {
  getToken(): Promise<unknown>;
  getAccount(): Promise<unknown>;
  getLicenses(): Promise<unknown>;
  listIncidents(): Promise<unknown>;
};

async function toServiceTest(promise: Promise<unknown>): Promise<ServiceTest> {
  return promise
    .then(() => ({ ok: true, status: 200, kind: null, message: "OK" }))
    .catch((error) => {
      if (error instanceof WatchGuardError) {
        return { ok: false, status: error.status, kind: error.kind, message: error.message };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, status: null, kind: "network", message };
    });
}

/** Run the four service checks independently so one failure is visible per-service. */
export async function runServiceChecks(target: CheckTarget): Promise<ServiceChecks> {
  const [auth, account, endpointSecurity, threatSync] = await Promise.all([
    toServiceTest(target.getToken()),
    toServiceTest(target.getAccount()),
    toServiceTest(target.getLicenses()),
    toServiceTest(target.listIncidents()),
  ]);
  return { auth, account, endpointSecurity, threatSync };
}

export type ConnectionTestResult =
  | { configured: false; reason: ResolveReason }
  | { configured: true; read?: ServiceChecks; write?: ServiceChecks };

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

  if (!read.ok && !write.ok) {
    return { configured: false, reason: read.reason };
  }

  const result: ConnectionTestResult = { configured: true };
  if (read.ok) {
    result.read = await runServiceChecks(deps.checkTarget(read.credentials, { credentialRevision: read.credentialRevision }));
  }
  if (write.ok && (!read.ok || write.credentials.accessId !== read.credentials.accessId)) {
    result.write = await runServiceChecks(deps.checkTarget(write.credentials, { credentialRevision: write.credentialRevision }));
  }
  return result;
}