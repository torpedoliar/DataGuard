import { and, eq, like, ne } from "drizzle-orm";
import { db } from "@/db";
import { devices, incidentUpdates, incidents, ncmSettings } from "@/db/schema";
import { resolveNcmConfig, fetchNcmSwitches, touchNcmLastSeen } from "@/lib/ncm";
import type { IncidentSeverity } from "@/lib/incidents";

// ==================== NCM fleet heartbeat (ticket 09) ====================
// Pure-ish domain logic for the per-site heartbeat: success → last_seen +
// status online (and auto-resolve the open offline incident); failure → miss
// streak, at NCM_OFFLINE_THRESHOLD consecutive misses flip status to offline
// and file one High incident (dedupe: at most one open offline incident per
// site). Scheduling (worker script / cron route / check-now action) lives in
// its callers; tests fake the deps.

export const NCM_OFFLINE_THRESHOLD = 3;

export type NcmHeartbeatOutcome = {
    siteId: number;
    configured: boolean;
    ok: boolean;
    /** status column after this check (null = row untouched / unconfigured). */
    status: "online" | "offline" | null;
    missCount: number | null;
    incidentId: number | null;
    /** Incident created by THIS check (as opposed to one already open). */
    incidentCreated: boolean;
    error: string | null;
};

/** Minimal DB surface checkNcmSite needs — trivially faked in tests. */
export type NcmHeartbeatDeps = {
    resolveNcmConfig(siteId: number): Promise<{ url: string | null; adminApiKey: string | null }>;
    pingNcm(config: { url: string; adminApiKey: string }): Promise<unknown>;
    touchNcmLastSeen(siteId: number): Promise<void>;
    getHeartbeatRow(siteId: number): Promise<{ status: string | null; missCount: number | null } | null>;
    setHeartbeatRow(siteId: number, values: { status: "online" | "offline"; missCount: number; lastSeenAt?: Date }): Promise<void>;
    findDevicesBySite(siteId: number): Promise<{ id: number; name: string }[]>;
    findOpenOfflineIncident(siteId: number): Promise<{ id: number; title: string } | null>;
    insertIncident(values: {
        siteId: number;
        deviceId: number;
        title: string;
        description: string | null;
        severity: IncidentSeverity;
    }): Promise<{ id: number; title: string }>;
    insertIncidentUpdate(values: { incidentId: number; note: string; newStatus: string }): Promise<void>;
    resolveIncident(incidentId: number, note: string): Promise<void>;
};

const OFFLINE_MARKER = "ncm_site_offline";

/** Dedupe marker: at most one open "Site offline" incident per site. */
function offlineIncidentTitle(siteName: string): string {
    return `Site NCM offline: ${siteName}`;
}

export async function checkNcmSite(
    deps: NcmHeartbeatDeps,
    input: { siteId: number; siteName: string },
): Promise<NcmHeartbeatOutcome> {
    const { siteId, siteName } = input;

    const config = await deps.resolveNcmConfig(siteId);
    if (!config.url || !config.adminApiKey) {
        return { siteId, configured: false, ok: false, status: null, missCount: null, incidentId: null, incidentCreated: false, error: null };
    }

    const row = await deps.getHeartbeatRow(siteId);
    const wasOffline = row?.status === "offline";

    let pingError: string | null = null;
    try {
        await deps.pingNcm({ url: config.url, adminApiKey: config.adminApiKey });
    } catch (error) {
        pingError = error instanceof Error ? error.message : String(error);
    }

    if (!pingError) {
        await deps.touchNcmLastSeen(siteId);
        if (wasOffline) {
            // Recovery: the open offline incident closes with the same
            // resolveIncident the ingest path uses (transactional update+note).
            const open = await deps.findOpenOfflineIncident(siteId);
            if (open) {
                await deps.resolveIncident(open.id, "Auto-resolved: NCM merespons kembali (heartbeat).");
            }
        }
        await deps.setHeartbeatRow(siteId, { status: "online", missCount: 0, lastSeenAt: new Date() });
        return { siteId, configured: true, ok: true, status: "online", missCount: 0, incidentId: null, incidentCreated: false, error: null };
    }

    const missCount = (row?.missCount ?? 0) + 1;
    let incidentId: number | null = null;
    let incidentCreated = false;

    if (missCount >= NCM_OFFLINE_THRESHOLD) {
        await deps.setHeartbeatRow(siteId, { status: "offline", missCount });
        if (!wasOffline) {
            // Dedupe: only the transition online→offline files the incident;
            // later misses keep the site offline without re-filing.
            const open = await deps.findOpenOfflineIncident(siteId);
            if (!open) {
                const deviceList = await deps.findDevicesBySite(siteId);
                const deviceId = deviceList[0]?.id;
                if (deviceId === undefined) {
                    // incidents.device_id is NOT NULL — no device, no incident
                    // (same contract as the ingest route's 503 path).
                    console.warn(`[ncm-heartbeat] site "${siteName}" offline but has no device; incident not filed.`);
                } else {
                    const created = await deps.insertIncident({
                        siteId,
                        deviceId,
                        title: offlineIncidentTitle(siteName),
                        description: [
                            `NCM di ${config.url} tidak menjawab ${missCount}x berturut-turut (threshold ${NCM_OFFLINE_THRESHOLD}).`,
                            `Error terakhir: ${pingError}`,
                            OFFLINE_MARKER,
                        ].join("\n"),
                        severity: "High",
                    });
                    await deps.insertIncidentUpdate({
                        incidentId: created.id,
                        note: `Created by fleet heartbeat after ${missCount} consecutive misses. ${OFFLINE_MARKER}`,
                        newStatus: "Open",
                    });
                    incidentId = created.id;
                    incidentCreated = true;
                }
            }
        }
    } else {
        // Below threshold: remember the streak, leave status as-is.
        await deps.setHeartbeatRow(siteId, { status: wasOffline ? "offline" : "online", missCount });
    }

    return { siteId, configured: true, ok: false, status: wasOffline || missCount >= NCM_OFFLINE_THRESHOLD ? "offline" : "online", missCount, incidentId, incidentCreated, error: pingError };
}

/** Check every configured site. Never throws per-site; results per site. */
export async function runHeartbeatAllSites(deps: NcmHeartbeatDeps, input: { sites: { id: number; name: string }[] }) {
    const results: NcmHeartbeatOutcome[] = [];
    for (const site of input.sites) {
        try {
            results.push(await checkNcmSite(deps, { siteId: site.id, siteName: site.name }));
        } catch (error) {
            console.error(`[ncm-heartbeat] site "${site.name}" check crashed:`, error);
        }
    }
    return results;
}

// ==================== DB-backed deps (worker/cron/action callers) ====================

export const ncmHeartbeatDeps: NcmHeartbeatDeps = {
    resolveNcmConfig,

    pingNcm: (config) => fetchNcmSwitches(config),

    touchNcmLastSeen,

    async getHeartbeatRow(siteId) {
        const rows = await db.select({ status: ncmSettings.status, missCount: ncmSettings.missCount })
            .from(ncmSettings).where(eq(ncmSettings.siteId, siteId));
        return rows[0] ?? null;
    },

    async setHeartbeatRow(siteId, values) {
        await db.update(ncmSettings).set({
            status: values.status,
            missCount: values.missCount,
            ...(values.lastSeenAt ? { lastSeenAt: values.lastSeenAt } : {}),
            updatedAt: new Date(),
        }).where(eq(ncmSettings.siteId, siteId));
    },

    async findDevicesBySite(siteId) {
        return db.select({ id: devices.id, name: devices.name })
            .from(devices).where(eq(devices.siteId, siteId)).orderBy(devices.id);
    },

    async findOpenOfflineIncident(siteId) {
        const rows = await db.select({ id: incidents.id, title: incidents.title })
            .from(incidents)
            .where(and(
                eq(incidents.siteId, siteId),
                like(incidents.title, "Site NCM offline:%"),
                ne(incidents.status, "Verified"),
            ))
            .limit(1);
        return rows[0] ?? null;
    },

    async insertIncident(values) {
        const [row] = await db.insert(incidents).values({
            siteId: values.siteId,
            deviceId: values.deviceId,
            title: values.title,
            description: values.description,
            severity: values.severity,
            status: "Open",
        }).returning({ id: incidents.id, title: incidents.title });
        return row!;
    },

    async insertIncidentUpdate(values) {
        await db.insert(incidentUpdates).values({
            incidentId: values.incidentId,
            updateType: "comment",
            note: values.note,
            newStatus: values.newStatus as "Open",
        });
    },

    async resolveIncident(incidentId, note) {
        await db.transaction(async (tx) => {
            await tx.update(incidents)
                .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date() })
                .where(eq(incidents.id, incidentId));
            await tx.insert(incidentUpdates).values({
                incidentId,
                updateType: "status_changed",
                note,
                previousStatus: "Open",
                newStatus: "Resolved",
            });
        });
    },
};
