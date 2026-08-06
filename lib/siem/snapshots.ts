import { db } from "../../db";
import {
  siemAlerts,
  siemDashboardSnapshots,
  siemFindings,
  sites,
  syslogEvents,
  syslogEventsRaw,
  syslogSources,
} from "../../db/schema";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";

/**
 * Counter shape that gets persisted into siem_dashboard_snapshots.
 * The seven numbers shown on the SIEM dashboard.
 */
export type SiemCounters = {
  raw24h: number;
  parsed24h: number;
  openFindings: number;
  criticalFindings: number;
  unmappedSources: number;
  pendingAlerts: number;
  failedAlerts: number;
};

/**
 * A single row from siem_dashboard_snapshots as returned by getSiemSnapshots.
 */
export type SiemSnapshot = SiemCounters & {
  id: number;
  capturedAt: Date;
};

/**
 * Take a snapshot of the current SIEM state and insert it into
 * `siem_dashboard_snapshots`.
 *
 * Per-site: when `siteId` is given, captures one row for that site. When
 * omitted, loops every active site and captures a row per site (headless
 * worker path). The dashboard action passes its active site; the worker omits
 * it so all sites accumulate history.
 */
export async function captureSiemSnapshot(siteId?: number): Promise<{ capturedAt: Date; counters: SiemCounters }> {
  const targets = siteId ? [siteId] : (await db.select({ id: sites.id }).from(sites).where(eq(sites.isActive, true))).map((s) => s.id);
  // ponytail: no sites yet → no snapshot row. The dashboard's lazy path still
  // returns zero counters without history; add per-site rows once a site exists.
  if (targets.length === 0) {
    return { capturedAt: new Date(), counters: { raw24h: 0, parsed24h: 0, openFindings: 0, criticalFindings: 0, unmappedSources: 0, pendingAlerts: 0, failedAlerts: 0 } };
  }

  let lastCapturedAt = new Date();
  let lastCounters: SiemCounters = { raw24h: 0, parsed24h: 0, openFindings: 0, criticalFindings: 0, unmappedSources: 0, pendingAlerts: 0, failedAlerts: 0 };

  for (const targetSiteId of targets) {
    const counters = await captureSiteCounters(targetSiteId);
    const [inserted] = await db
      .insert(siemDashboardSnapshots)
      .values({ ...counters, siteId: targetSiteId })
      .returning({ id: siemDashboardSnapshots.id, capturedAt: siemDashboardSnapshots.capturedAt });
    lastCapturedAt = inserted?.capturedAt ?? new Date();
    lastCounters = counters;
  }

  return { capturedAt: lastCapturedAt, counters: lastCounters };
}

async function captureSiteCounters(siteId: number): Promise<SiemCounters> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    raw24h,
    parsed24h,
    openFindings,
    criticalFindings,
    unmappedSources,
    pendingAlerts,
    failedAlerts,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(syslogEventsRaw)
      .where(and(eq(syslogEventsRaw.siteId, siteId), gte(syslogEventsRaw.receivedAt, since24h))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(syslogEvents)
      .where(and(eq(syslogEvents.siteId, siteId), gte(syslogEvents.receivedAt, since24h))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemFindings)
      .where(and(eq(siemFindings.siteId, siteId), ne(siemFindings.status, "Resolved"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemFindings)
      .where(and(eq(siemFindings.siteId, siteId), eq(siemFindings.severity, "Critical"), ne(siemFindings.status, "Resolved"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(syslogSources)
      .where(and(eq(syslogSources.siteId, siteId), isNull(syslogSources.deviceId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemAlerts)
      .innerJoin(siemFindings, eq(siemAlerts.findingId, siemFindings.id))
      .where(and(eq(siemFindings.siteId, siteId), eq(siemAlerts.status, "pending"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemAlerts)
      .innerJoin(siemFindings, eq(siemAlerts.findingId, siemFindings.id))
      .where(and(eq(siemFindings.siteId, siteId), eq(siemAlerts.status, "failed"))),
  ]);

  return {
    raw24h: Number(raw24h[0]?.count ?? 0),
    parsed24h: Number(parsed24h[0]?.count ?? 0),
    openFindings: Number(openFindings[0]?.count ?? 0),
    criticalFindings: Number(criticalFindings[0]?.count ?? 0),
    unmappedSources: Number(unmappedSources[0]?.count ?? 0),
    pendingAlerts: Number(pendingAlerts[0]?.count ?? 0),
    failedAlerts: Number(failedAlerts[0]?.count ?? 0),
  };
}

/**
 * Return historical snapshots captured at or after `sinceIso`, scoped to a site.
 *
 * Ordered ascending by `capturedAt` so callers can render left-to-right
 * charts without an extra sort.
 */
export async function getSiemSnapshots(sinceIso: string, siteId?: number): Promise<SiemSnapshot[]> {
  const since = new Date(sinceIso);
  const rows = await db
    .select()
    .from(siemDashboardSnapshots)
    .where(and(gte(siemDashboardSnapshots.capturedAt, since), siteId ? eq(siemDashboardSnapshots.siteId, siteId) : sql`true`))
    .orderBy(siemDashboardSnapshots.capturedAt);

  return rows.map((row) => ({
    id: row.id,
    capturedAt: row.capturedAt,
    raw24h: row.raw24h,
    parsed24h: row.parsed24h,
    openFindings: row.openFindings,
    criticalFindings: row.criticalFindings,
    unmappedSources: row.unmappedSources,
    pendingAlerts: row.pendingAlerts,
    failedAlerts: row.failedAlerts,
  }));
}
