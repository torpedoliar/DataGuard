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

/** Diff view for one review. NCM serves the raw diff as text at
 * /reviews/{id}/diff (no JSON GET /reviews/{id} exists). */
export async function fetchNcmReview(config: NcmConnection, reviewId: number): Promise<unknown> {
    const base = config.url.replace(/\/+$/, "") + "/api/v1/reviews/" + reviewId + "/diff";
    let response: Response;
    try {
        response = await fetch(base, {
            headers: { "X-API-Key": config.adminApiKey, Accept: "text/plain" },
            signal: AbortSignal.timeout(NCM_TIMEOUT_MS),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error("Gagal terhubung ke " + base + ": " + reason);
    }
    if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        throw new Error("NCM API responded " + response.status + ": " + responseBody.trim().slice(0, 200));
    }
    return response.text();
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
// (which encrypts at rest) and is never read back here. NCM's API only has a
// global /credentials router — per-switch rotation maps to create + re-point
// the switch, so these helpers compose those two calls.
export async function createNcmCredentials(config: NcmConnection, switchId: number, body: Record<string, unknown>): Promise<unknown> {
    const name = (body.name as string | undefined) ?? `dg-switch-${switchId}`;
    let credential: { id?: number } | null = null;
    try {
        credential = (await ncmRequest(config, "POST", "credentials", { ...body, name })) as { id?: number };
    } catch (error) {
        // Name collision: NCM requires globally-unique credential names but the
        // UI only knows switches. Reset the existing credential of that name
        // instead of failing the rotation. GET /credentials is JWT-only, so
        // re-create with a deterministic unique name and switch over to it.
        if (!(error instanceof Error) || !error.message.includes("409")) throw error;
        const retryName = `${name}-${Date.now()}`;
        credential = (await ncmRequest(config, "POST", "credentials", { ...body, name: retryName })) as { id?: number };
    }
    if (typeof credential?.id !== "number") {
        throw new Error("NCM tidak mengembalikan id kredensial");
    }
    return ncmRequest(config, "PATCH", "switches/" + switchId, { credential_id: credential.id });
}

export async function updateNcmCredentials(config: NcmConnection, switchId: number, body: Record<string, unknown>): Promise<unknown> {
    return createNcmCredentials(config, switchId, body);
}

export async function deleteNcmCredentials(config: NcmConnection, switchId: number): Promise<unknown> {
    const switches = await ncmGet(config, "switches");
    const target = Array.isArray(switches)
        ? switches.find((s) => typeof s === "object" && s !== null && (s as { id?: unknown }).id === switchId)
        : null;
    const credentialId = target ? (target as { credential_id?: unknown }).credential_id : null;
    if (typeof credentialId !== "number") {
        return null; // switch already credential-less; nothing to delete
    }
    return ncmRequest(config, "DELETE", "credentials/" + credentialId);
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
    // NCM requires kind; backup_id alone implies a switch-level golden snapshot.
    // switch_id is needed to satisfy the switch-baseline uniqueness check.
    const payload = { kind: "switch", ...body } as Record<string, unknown>;
    if (payload.backup_id !== undefined && payload.switch_id === undefined) {
        const backups = await ncmGet(config, "backups");
        const source = Array.isArray(backups)
            ? backups.find((b) => typeof b === "object" && b !== null && (b as { id?: unknown }).id === payload.backup_id)
            : null;
        const switchId = source ? (source as { switch_id?: unknown }).switch_id : null;
        if (typeof switchId !== "number") {
            throw new Error("Backup tidak ditemukan di NCM untuk membuat baseline");
        }
        payload.switch_id = switchId;
    }
    try {
        return await ncmRequest(config, "POST", "baselines", payload);
    } catch (error) {
        // The probe flow creates a fresh backup of a fresh switch whose golden
        // baseline may already exist (409: switch already has a baseline). The
        // drift-chain review still opens against the existing baseline, so
        // confirm the baseline list is non-empty and treat that as the golden.
        if (!(error instanceof Error) || !error.message.includes("409")) throw error;
        const baselines = await fetchNcmBaselines(config);
        const match = Array.isArray(baselines)
            ? baselines.find((b) => typeof b === "object" && b !== null && (b as { switch_id?: unknown }).switch_id === payload.switch_id)
            : null;
        if (!match) throw error;
        return match;
    }
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
    // NCM's decision endpoint is POST /reviews/{id}/status with status
    // approved|flagged|dismissed (reject maps to flagged) + comment.
    const status = body.decision === "approve" ? "approved" : "flagged";
    return ncmRequest(config, "POST", "reviews/" + reviewId + "/status", {
        status,
        ...(body.note ? { comment: body.note } : {}),
    });
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
