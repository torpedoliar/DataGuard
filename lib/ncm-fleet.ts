import { and, eq, like, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { incidents, ncmSettings, sites } from "@/db/schema";
import { decryptIfEncrypted } from "./crypto";

// ==================== NCM fleet snapshot (ticket 10) ====================
// One-screen multi-site view: per-site status badges (heartbeat row +
// lastSeenAt) with open-drift counts, plus one cross-site table of open
// drift reviews. Live-fetch by design (SPEC: transient, no sync table):
// every configured site is polled via fetchNcmReviews and an unreachable
// site degrades to a red badge — never a crash. Pure helpers (pick/asRows,
// isOpenReview, buildFleetSnapshot aggregation) are unit-tested; the
// DB/live-fetch seams take injectable deps so tests never touch Postgres.

export type NcmReviewRow = Record<string, unknown>;

/** NCM review lifecycle: pending/in_review are still open, the rest decided. */
const OPEN_REVIEW_STATUSES = new Set(["pending", "in_review"]);

/** Statuses that count as "open drift" on a DG incident row. */
export const OPEN_DRIFT_INCIDENT_STATUSES = ["Open", "In Progress"] as const;

export type FleetSite = {
    siteId: number;
    siteName: string;
    configured: boolean;
    status: "online" | "offline" | null;
    lastSeenAt: Date | null;
    reachable: boolean;
    error: string | null;
    openDriftCount: number;
};

export type FleetDriftRow = {
    siteId: number;
    siteName: string;
    reviewId: string;
    switchLabel: string;
    status: string;
    createdAt: string;
};

export type FleetSnapshot = {
    sites: FleetSite[];
    drifts: FleetDriftRow[];
    offlineCount: number;
    openDriftTotal: number;
    checkedAt: string;
};

// ncm-dashboard.tsx carries its own copies; the fleet table needs the same
// tolerant coercion (NCM field names drift: switch_id vs switchId, list
// envelopes {data}/{items}).
export function pick(row: NcmReviewRow, ...keys: string[]): string {
    for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") return String(value);
    }
    return "";
}

export function asRows(value: unknown): NcmReviewRow[] {
    if (Array.isArray(value)) return value as NcmReviewRow[];
    const container = value as { data?: unknown; items?: unknown } | null;
    if (container && Array.isArray(container.data)) return container.data as NcmReviewRow[];
    if (container && Array.isArray(container.items)) return container.items as NcmReviewRow[];
    return [];
}

/** A review counts as open drift while NCM still has it pending/in_review. */
export function isOpenReview(row: NcmReviewRow): boolean {
    const status = pick(row, "status", "state").trim().toLowerCase();
    if (!status) return true; // no status field → still awaiting a decision
    return OPEN_REVIEW_STATUSES.has(status);
}

export function toFleetDriftRow(siteId: number, siteName: string, row: NcmReviewRow): FleetDriftRow {
    return {
        siteId,
        siteName,
        reviewId: pick(row, "id", "review_id", "reviewId"),
        switchLabel: pick(row, "switch_name", "switchName", "switch_id", "switchId"),
        status: pick(row, "status", "state") || "pending",
        createdAt: pick(row, "created_at", "createdAt"),
    };
}

/** Minimal seams the fleet snapshot needs — faked in tests, DB-backed below. */
export type NcmFleetDeps = {
    listSites(): Promise<{ id: number; name: string }[]>;
    listHeartbeatRows(): Promise<{ siteId: number; status: string | null; lastSeenAt: Date | null }[]>;
    resolveConfig(siteId: number): Promise<{ url: string | null; adminApiKey: string | null }>;
    fetchReviews(config: { url: string; adminApiKey: string }): Promise<unknown>;
    countOpenDriftIncidents(siteId: number): Promise<number>;
};

type SiteFetch = {
    siteId: number;
    siteName: string;
    reviews: NcmReviewRow[] | null;
    error: string | null;
};

/** Aggregate one snapshot from heartbeat rows + per-site review fetches. */
export function buildFleetSnapshot(
    sites: { id: number; name: string }[],
    heartbeatBySite: Map<number, { status: string | null; lastSeenAt: Date | null }>,
    configuredBySite: Map<number, boolean>,
    fetches: SiteFetch[],
    driftCounts: Map<number, number>,
    checkedAt: string,
): FleetSnapshot {
    const snapshotSites: FleetSite[] = [];
    const drifts: FleetDriftRow[] = [];

    for (const site of sites) {
        const heartbeat = heartbeatBySite.get(site.id);
        const configured = configuredBySite.get(site.id) ?? false;
        const fetch = fetches.find((f) => f.siteId === site.id);
        const reachable = configured && fetch?.reviews !== null && fetch?.reviews !== undefined;
        const liveOpen = fetch?.reviews ? fetch.reviews.filter(isOpenReview) : [];
        const openDriftCount = liveOpen.length + (driftCounts.get(site.id) ?? 0);
        const status = heartbeat?.status === "offline" ? "offline" : heartbeat?.status === "online" ? "online" : null;

        snapshotSites.push({
            siteId: site.id,
            siteName: site.name,
            configured,
            status,
            lastSeenAt: heartbeat?.lastSeenAt ?? null,
            reachable,
            error: fetch?.error ?? null,
            openDriftCount,
        });

        for (const review of liveOpen) {
            drifts.push(toFleetDriftRow(site.id, site.name, review));
        }
    }

    return {
        sites: snapshotSites,
        drifts,
        offlineCount: snapshotSites.filter((s) => s.configured && s.status === "offline").length,
        openDriftTotal: drifts.length + [...driftCounts.values()].reduce((sum, n) => sum + n, 0),
        checkedAt,
    };
}

/**
 * Live fleet snapshot across every active site. Never throws per-site: an
 * unreachable NCM degrades to reachable=false + error on that site's badge
 * while the rest of the fleet still renders.
 */
export async function getFleetSnapshot(deps: NcmFleetDeps = ncmFleetDeps): Promise<FleetSnapshot> {
    const siteList = await deps.listSites();
    const [heartbeatRows, driftCounts] = await Promise.all([
        deps.listHeartbeatRows(),
        Promise.all(siteList.map(async (site) => ({ siteId: site.id, count: await deps.countOpenDriftIncidents(site.id) }))),
    ]);
    const heartbeatBySite = new Map(heartbeatRows.map((row) => [row.siteId, { status: row.status, lastSeenAt: row.lastSeenAt }]));

    const configuredBySite = new Map<number, boolean>();
    const fetches: SiteFetch[] = [];
    for (const site of siteList) {
        const config = await deps.resolveConfig(site.id);
        const configured = Boolean(config.url && config.adminApiKey);
        configuredBySite.set(site.id, configured);
        if (!configured) {
            fetches.push({ siteId: site.id, siteName: site.name, reviews: null, error: null });
            continue;
        }
        try {
            const reviews = await deps.fetchReviews({ url: config.url!, adminApiKey: config.adminApiKey! });
            fetches.push({ siteId: site.id, siteName: site.name, reviews: asRows(reviews), error: null });
        } catch (error) {
            fetches.push({ siteId: site.id, siteName: site.name, reviews: null, error: error instanceof Error ? error.message : String(error) });
        }
    }

    return buildFleetSnapshot(
        siteList,
        heartbeatBySite,
        configuredBySite,
        fetches,
        new Map(driftCounts.map((entry) => [entry.siteId, entry.count])),
        new Date().toISOString(),
    );
}

export const ncmFleetDeps: NcmFleetDeps = {
    async listSites() {
        return db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.isActive, true));
    },

    async listHeartbeatRows() {
        return db.select({ siteId: ncmSettings.siteId, status: ncmSettings.status, lastSeenAt: ncmSettings.lastSeenAt }).from(ncmSettings);
    },

    async resolveConfig(siteId) {
        const rows = await db.select({ url: ncmSettings.url, adminApiKey: ncmSettings.adminApiKey })
            .from(ncmSettings).where(eq(ncmSettings.siteId, siteId));
        const row = rows[0];
        let adminApiKey: string | null = null;
        if (row?.adminApiKey) {
            try {
                adminApiKey = decryptIfEncrypted(row.adminApiKey) || null;
            } catch {
                adminApiKey = null;
            }
        }
        return { url: row?.url?.trim() || null, adminApiKey };
    },

    async fetchReviews(config) {
        const { fetchNcmReviews } = await import("./ncm");
        return fetchNcmReviews(config);
    },

    async countOpenDriftIncidents(siteId) {
        const rows = await db.select({ id: incidents.id }).from(incidents).where(and(
            eq(incidents.siteId, siteId),
            like(incidents.title, "Config drift:%"),
            or(eq(incidents.status, OPEN_DRIFT_INCIDENT_STATUSES[0]), eq(incidents.status, OPEN_DRIFT_INCIDENT_STATUSES[1])),
            ne(incidents.status, "Verified"),
        ));
        return rows.length;
    },
};
