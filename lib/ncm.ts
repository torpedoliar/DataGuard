import { eq } from "drizzle-orm";
import { db } from "../db";
import { ncmSettings } from "../db/schema";
import { decryptIfEncrypted } from "./crypto";

// ==================== External API (NCM) ====================
// Read-only REST surface of the network configuration manager app.
// GET base + /api/v1/{switches,backups,reviews} requires scope "read",
// auth via X-API-Key or Bearer. Write endpoints land with ticket 02.

export const NCM_TIMEOUT_MS = 10_000;

export type NcmConfig = {
    url: string | null;
    adminApiKey: string | null;
};

export type NcmConnection = {
    url: string;
    adminApiKey: string;
};

/**
 * Per-site NCM config from the ncm_settings row. No env fallback by design
 * (unlike network-doc): NCM is per-site from day one, an empty/absent row
 * means the site is not connected. Never throws - callers get nulls.
 */
export async function resolveNcmConfig(siteId: number): Promise<NcmConfig> {
    let row: { url: string | null; adminApiKey: string | null } | null = null;
    try {
        const rows = await db.select({
            url: ncmSettings.url,
            adminApiKey: ncmSettings.adminApiKey,
        }).from(ncmSettings).where(eq(ncmSettings.siteId, siteId));
        row = rows[0] ?? null;
    } catch {
        // DB unreachable - nulls only.
    }

    let adminApiKey: string | null = null;
    if (row?.adminApiKey) {
        try {
            adminApiKey = decryptIfEncrypted(row.adminApiKey) || null;
        } catch {
            adminApiKey = null;
        }
    }

    return {
        url: row?.url?.trim() || null,
        adminApiKey,
    };
}

async function ncmGet(config: NcmConnection, path: string): Promise<unknown> {
    let base = config.url;
    while (base.endsWith("/")) base = base.slice(0, -1);
    const url = base + "/api/v1/" + path;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { "X-API-Key": config.adminApiKey, "Accept": "application/json" },
            signal: AbortSignal.timeout(NCM_TIMEOUT_MS),
        });
    } catch (error) {
        // Node fetch throws a bare "fetch failed" - include the URL so the
        // operator can see which host was unreachable (localhost in Docker is
        // the container itself, not the host).
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error("Gagal terhubung ke " + url + ": " + reason);
    }
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error("NCM API responded " + response.status + ": " + body.trim().slice(0, 200));
    }
    return response.json();
}

export async function fetchNcmSwitches(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "switches");
}

export async function fetchNcmBackups(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "backups");
}

export async function fetchNcmReviews(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "reviews");
}

/** Heartbeat: record that a site NCM connection was verified/used. */
export async function touchNcmLastSeen(siteId: number): Promise<void> {
    await db.update(ncmSettings).set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(ncmSettings.siteId, siteId));
}
