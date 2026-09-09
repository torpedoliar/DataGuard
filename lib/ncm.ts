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

async function ncmRequest(config: NcmConnection, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    let base = config.url;
    while (base.endsWith("/")) base = base.slice(0, -1);
    const url = base + "/api/v1/" + path;
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                "X-API-Key": config.adminApiKey,
                "Accept": "application/json",
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
        const responseBody = await response.text().catch(() => "");
        throw new Error("NCM API responded " + response.status + ": " + responseBody.trim().slice(0, 200));
    }
    // NCM DELETEs may answer 204 No Content — return null instead of parsing.
    if (response.status === 204) return null;
    const text = await response.text().catch(() => "");
    if (!text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function ncmGet(config: NcmConnection, path: string): Promise<unknown> {
    return ncmRequest(config, "GET", path);
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

export async function fetchNcmJobs(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "jobs");
}

export async function fetchNcmBaselines(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "baselines");
}

export async function fetchNcmReview(config: NcmConnection, reviewId: number): Promise<unknown> {
    return ncmGet(config, "reviews/" + reviewId);
}

export async function fetchNcmReviewRollback(config: NcmConnection, reviewId: number): Promise<unknown> {
    return ncmGet(config, "reviews/" + reviewId + "/rollback");
}

export async function createNcmSwitch(config: NcmConnection, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "POST", "switches", body);
}

export async function updateNcmSwitch(config: NcmConnection, switchId: number, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "PATCH", "switches/" + switchId, body);
}

export async function deleteNcmSwitch(config: NcmConnection, switchId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "switches/" + switchId);
}

// Credentials are a one-way pass-through: the plaintext body goes to NCM
// (which encrypts at rest) and is never read back here.
export async function createNcmCredentials(config: NcmConnection, switchId: number, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "POST", "switches/" + switchId + "/credentials", body);
}

export async function updateNcmCredentials(config: NcmConnection, switchId: number, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "PATCH", "switches/" + switchId + "/credentials", body);
}

export async function deleteNcmCredentials(config: NcmConnection, switchId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "switches/" + switchId + "/credentials");
}

export async function createNcmJob(config: NcmConnection, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "POST", "jobs", body);
}

export async function updateNcmJob(config: NcmConnection, jobId: number, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "PATCH", "jobs/" + jobId, body);
}

export async function deleteNcmJob(config: NcmConnection, jobId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "jobs/" + jobId);
}

export async function createNcmBaseline(config: NcmConnection, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "POST", "baselines", body);
}

export async function refreshNcmBaseline(config: NcmConnection, baselineId: number): Promise<unknown> {
    return ncmRequest(config, "POST", "baselines/" + baselineId + "/refresh", {});
}

export async function deleteNcmBaseline(config: NcmConnection, baselineId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "baselines/" + baselineId);
}

export async function triggerNcmBackup(config: NcmConnection, switchId: number): Promise<unknown> {
    return ncmRequest(config, "POST", "switches/" + switchId + "/backup", {});
}

export async function decideNcmReview(config: NcmConnection, reviewId: number, body: { decision: string; note?: string }): Promise<unknown> {
    return ncmRequest(config, "PATCH", "reviews/" + reviewId, body);
}

/** Banner offline: baca heartbeat last_seen_at (transient, tidak disync). */
export async function getNcmLastSeen(siteId: number): Promise<Date | null> {
    try {
        const rows = await db.select({ lastSeenAt: ncmSettings.lastSeenAt })
            .from(ncmSettings).where(eq(ncmSettings.siteId, siteId));
        return rows[0]?.lastSeenAt ?? null;
    } catch {
        return null;
    }
}

/** Heartbeat: record that a site NCM connection was verified/used. */
export async function touchNcmLastSeen(siteId: number): Promise<void> {
    await db.update(ncmSettings).set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(ncmSettings.siteId, siteId));
}
