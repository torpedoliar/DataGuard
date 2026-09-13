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

export async function fetchNcmReviews(config: NcmConnection, includeNotes: boolean = false): Promise<unknown> {
    return ncmGet(config, includeNotes ? "reviews?include_notes=true" : "reviews");
}

export async function fetchNcmJobs(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "jobs");
}

export async function fetchNcmBaselines(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "baselines");
}

export async function fetchNcmCredentials(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "credentials");
}

export async function createNcmCredential(config: NcmConnection, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "POST", "credentials", body);
}

export async function updateNcmCredential(config: NcmConnection, credId: number, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "PATCH", "credentials/" + credId, body);
}

export async function deleteNcmCredential(config: NcmConnection, credId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "credentials/" + credId);
}

export async function fetchNcmBackupContent(config: NcmConnection, backupId: number): Promise<string> {
    const base = config.url.replace(/\/+$/, "") + "/api/v1/backups/" + backupId + "/content";
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
    const payload = { ...body };
    if (!payload.credential_id && payload.username && payload.password) {
        const credName = (payload.credential_name as string) || `cred-${payload.name || Date.now()}`;
        let credential: { id?: number } | null = null;
        try {
            credential = (await ncmRequest(config, "POST", "credentials", {
                name: credName,
                username: payload.username,
                password: payload.password,
                enable_password: payload.enable_password || "",
            })) as { id?: number };
        } catch (error) {
            if (error instanceof Error && error.message.includes("409")) {
                const retryName = `${credName}-${Date.now()}`;
                credential = (await ncmRequest(config, "POST", "credentials", {
                    name: retryName,
                    username: payload.username,
                    password: payload.password,
                    enable_password: payload.enable_password || "",
                })) as { id?: number };
            } else {
                throw error;
            }
        }
        if (credential?.id) {
            payload.credential_id = credential.id;
        }
    }
    const { username, password, enable_password, credential_name, ...switchData } = payload;
    return ncmRequest(config, "POST", "switches", switchData);
}

export async function updateNcmSwitch(config: NcmConnection, switchId: number, body: Record<string, unknown>): Promise<unknown> {
    return ncmRequest(config, "PATCH", "switches/" + switchId, body);
}

export async function deleteNcmSwitch(config: NcmConnection, switchId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "switches/" + switchId);
}

/** Push DG-owned webhook config into NCM runtime settings
 * (PATCH /system/notify-settings, scope system:write). Empty strings clear
 * the NCM side (webhook disabled there); error mapping comes free via
 * ncmRequest (10s timeout, status in message). */
export async function setNcmWebhook(config: NcmConnection, webhookUrl: string, webhookSecret: string): Promise<unknown> {
    return ncmRequest(config, "PATCH", "system/notify-settings", {
        webhook_url: webhookUrl,
        webhook_secret: webhookSecret,
    });
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
    const payload = { kind: "switch", repoint: true, ...body } as Record<string, unknown>;
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
    return ncmRequest(config, "POST", "baselines", payload);
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

export async function decideNcmReview(config: NcmConnection, reviewId: number, body: { decision: string; note?: string; reset_baseline_cycle?: boolean }): Promise<unknown> {
    // NCM's decision endpoint is POST /reviews/{id}/status with status
    // approved|flagged|dismissed (reject maps to flagged) + comment.
    const status = body.decision === "approve" ? "approved" : "flagged";
    const payload: Record<string, unknown> = {
        status,
        ...(body.note ? { comment: body.note } : {}),
    };
    if (body.reset_baseline_cycle !== undefined) {
        payload.reset_baseline_cycle = body.reset_baseline_cycle;
    }
    return ncmRequest(config, "POST", "reviews/" + reviewId + "/status", payload);
}

export async function startNcmReview(config: NcmConnection, reviewId: number, starterName?: string): Promise<unknown> {
    return ncmRequest(config, "POST", "reviews/" + reviewId + "/start", starterName ? { starter_name: starterName } : {});
}

export async function promoteNcmReview(config: NcmConnection, reviewId: number, reason: string, comment?: string, reviewerName?: string): Promise<unknown> {
    const payload: Record<string, unknown> = { reason };
    if (comment) payload.comment = comment;
    if (reviewerName) payload.reviewer_name = reviewerName;
    return ncmRequest(config, "POST", "reviews/" + reviewId + "/promote-baseline", payload);
}

export async function updateNcmReviewStatus(config: NcmConnection, reviewId: number, body: { status: string; comment?: string; reset_baseline_cycle?: boolean; reviewer_name?: string }): Promise<unknown> {
    return ncmRequest(config, "POST", "reviews/" + reviewId + "/status", body);
}

export async function deleteNcmReview(config: NcmConnection, reviewId: number): Promise<unknown> {
    return ncmRequest(config, "DELETE", "reviews/" + reviewId);
}

export async function fetchNcmReviewNotes(config: NcmConnection, reviewId: number): Promise<unknown> {
    return ncmGet(config, "reviews/" + reviewId + "/notes");
}

export async function addNcmReviewNote(config: NcmConnection, reviewId: number, body: string): Promise<unknown> {
    return ncmRequest(config, "POST", "reviews/" + reviewId + "/notes", { body });
}

export async function prepareNcmBaselineReview(config: NcmConnection, baselineId: number): Promise<unknown> {
    return ncmRequest(config, "POST", "baselines/" + baselineId + "/prepare-review", {});
}

export async function fetchNcmCompliance(config: NcmConnection): Promise<unknown> {
    return ncmGet(config, "reviews/compliance");
}

export async function runNcmReviewCycle(config: NcmConnection): Promise<unknown> {
    return ncmRequest(config, "POST", "reviews/run-cycle", {});
}

export async function sendNcmReviewReminder(config: NcmConnection): Promise<unknown> {
    return ncmRequest(config, "POST", "reviews/reminder", {});
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
