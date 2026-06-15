import { db } from "../../db";
import {
  siemAlerts,
  siemDashboardSnapshots,
  siemFindings,
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
 * The dashboard action calls this on the lazy path so that even deployments
 * without the snapshot worker will start accumulating history. The
 * `scripts/siem-snapshot-worker.ts` worker also calls it on a 1h interval.
 */
export async function captureSiemSnapshot(): Promise<{ capturedAt: Date; counters: SiemCounters }> {
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
      .where(gte(syslogEventsRaw.receivedAt, since24h)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(syslogEvents)
      .where(gte(syslogEvents.receivedAt, since24h)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemFindings)
      .where(ne(siemFindings.status, "Resolved")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemFindings)
      .where(
        and(eq(siemFindings.severity, "Critical"), ne(siemFindings.status, "Resolved")),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(syslogSources)
      .where(isNull(syslogSources.deviceId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemAlerts)
      .where(eq(siemAlerts.status, "pending")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(siemAlerts)
      .where(eq(siemAlerts.status, "failed")),
  ]);

  const counters: SiemCounters = {
    raw24h: Number(raw24h[0]?.count ?? 0),
    parsed24h: Number(parsed24h[0]?.count ?? 0),
    openFindings: Number(openFindings[0]?.count ?? 0),
    criticalFindings: Number(criticalFindings[0]?.count ?? 0),
    unmappedSources: Number(unmappedSources[0]?.count ?? 0),
    pendingAlerts: Number(pendingAlerts[0]?.count ?? 0),
    failedAlerts: Number(failedAlerts[0]?.count ?? 0),
  };

  const [inserted] = await db
    .insert(siemDashboardSnapshots)
    .values(counters)
    .returning({ id: siemDashboardSnapshots.id, capturedAt: siemDashboardSnapshots.capturedAt });

  return {
    capturedAt: inserted?.capturedAt ?? new Date(),
    counters,
  };
}

/**
 * Return historical snapshots captured at or after `sinceIso`.
 *
 * Ordered ascending by `capturedAt` so callers can render left-to-right
 * charts without an extra sort.
 */
export async function getSiemSnapshots(sinceIso: string): Promise<SiemSnapshot[]> {
  const since = new Date(sinceIso);
  const rows = await db
    .select()
    .from(siemDashboardSnapshots)
    .where(gte(siemDashboardSnapshots.capturedAt, since))
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
