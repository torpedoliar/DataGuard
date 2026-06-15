"use server";

import { db } from "@/db";
import { siemAlerts, siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { captureSiemSnapshot, getSiemSnapshots, type SiemSnapshot } from "@/lib/siem/snapshots";

const TIMESERIES_WINDOWS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

type TimeseriesWindow = keyof typeof TIMESERIES_WINDOWS;

async function loadTimeseries(): Promise<Record<TimeseriesWindow, SiemSnapshot[]>> {
  // Load the largest window once and bucket the rows in-process. Snapshots are
  // small (one integer row per hour), so the 30d set fits comfortably in memory
  // and avoids three separate DB round-trips.
  const since30d = new Date(Date.now() - TIMESERIES_WINDOWS["30d"]).toISOString();
  const all = await getSiemSnapshots(since30d);

  const now = Date.now();
  const out: Record<TimeseriesWindow, SiemSnapshot[]> = {
    "24h": [],
    "7d": [],
    "30d": [],
  };
  for (const snap of all) {
    const age = now - snap.capturedAt.getTime();
    if (age <= TIMESERIES_WINDOWS["24h"]) out["24h"].push(snap);
    if (age <= TIMESERIES_WINDOWS["7d"]) out["7d"].push(snap);
    if (age <= TIMESERIES_WINDOWS["30d"]) out["30d"].push(snap);
  }
  return out;
}

export async function getSiemDashboardStats() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [raw24h, parsed24h, openFindings, criticalFindings, unmappedSources, pendingAlerts, failedAlerts] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(syslogEventsRaw).where(gte(syslogEventsRaw.receivedAt, since24h)),
    db.select({ count: sql<number>`count(*)::int` }).from(syslogEvents).where(and(eq(syslogEvents.siteId, auth.activeSiteId), gte(syslogEvents.receivedAt, since24h))),
    db.select({ count: sql<number>`count(*)::int` }).from(siemFindings).where(and(eq(siemFindings.siteId, auth.activeSiteId), ne(siemFindings.status, "Resolved"))),
    db.select({ count: sql<number>`count(*)::int` }).from(siemFindings).where(and(eq(siemFindings.siteId, auth.activeSiteId), eq(siemFindings.severity, "Critical"), ne(siemFindings.status, "Resolved"))),
    db.select({ count: sql<number>`count(*)::int` }).from(syslogSources).where(and(eq(syslogSources.siteId, auth.activeSiteId), isNull(syslogSources.deviceId))),
    db.select({ count: sql<number>`count(*)::int` }).from(siemAlerts).innerJoin(siemFindings, eq(siemAlerts.findingId, siemFindings.id)).where(and(eq(siemFindings.siteId, auth.activeSiteId), eq(siemAlerts.status, "pending"))),
    db.select({ count: sql<number>`count(*)::int` }).from(siemAlerts).innerJoin(siemFindings, eq(siemAlerts.findingId, siemFindings.id)).where(and(eq(siemFindings.siteId, auth.activeSiteId), eq(siemAlerts.status, "failed"))),
  ]);

  const latestFindings = await db.query.siemFindings.findMany({
    where: eq(siemFindings.siteId, auth.activeSiteId),
    orderBy: (table, { desc }) => [desc(table.lastSeenAt)],
    limit: 5,
    with: { rule: true, source: true, device: true },
  });

  // History: try to load the snapshots that the worker has been collecting.
  // If the table is empty (fresh deploy with no worker yet), take a single
  // lazy snapshot so the dashboard shows at least one data point.
  let timeseries = await loadTimeseries();
  if (timeseries["30d"].length === 0) {
    try {
      await captureSiemSnapshot();
      timeseries = await loadTimeseries();
    } catch (error) {
      // Capture failure should never break the dashboard. Charts just stay empty.
      console.error("Lazy SIEM snapshot capture failed", error);
    }
  }

  return {
    raw24h: Number(raw24h[0]?.count ?? 0),
    parsed24h: Number(parsed24h[0]?.count ?? 0),
    openFindings: Number(openFindings[0]?.count ?? 0),
    criticalFindings: Number(criticalFindings[0]?.count ?? 0),
    unmappedSources: Number(unmappedSources[0]?.count ?? 0),
    pendingAlerts: Number(pendingAlerts[0]?.count ?? 0),
    failedAlerts: Number(failedAlerts[0]?.count ?? 0),
    latestFindings: latestFindings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      lastSeenAt: finding.lastSeenAt,
      ruleName: finding.rule?.name ?? null,
      sourceIp: finding.source?.sourceIp ?? null,
      deviceName: finding.device?.name ?? null,
    })),
    timeseries: {
      "24h": timeseries["24h"].map((snap) => ({
        capturedAt: snap.capturedAt.toISOString(),
        raw24h: snap.raw24h,
        parsed24h: snap.parsed24h,
        openFindings: snap.openFindings,
        criticalFindings: snap.criticalFindings,
        unmappedSources: snap.unmappedSources,
        pendingAlerts: snap.pendingAlerts,
        failedAlerts: snap.failedAlerts,
      })),
      "7d": timeseries["7d"].map((snap) => ({
        capturedAt: snap.capturedAt.toISOString(),
        raw24h: snap.raw24h,
        parsed24h: snap.parsed24h,
        openFindings: snap.openFindings,
        criticalFindings: snap.criticalFindings,
        unmappedSources: snap.unmappedSources,
        pendingAlerts: snap.pendingAlerts,
        failedAlerts: snap.failedAlerts,
      })),
      "30d": timeseries["30d"].map((snap) => ({
        capturedAt: snap.capturedAt.toISOString(),
        raw24h: snap.raw24h,
        parsed24h: snap.parsed24h,
        openFindings: snap.openFindings,
        criticalFindings: snap.criticalFindings,
        unmappedSources: snap.unmappedSources,
        pendingAlerts: snap.pendingAlerts,
        failedAlerts: snap.failedAlerts,
      })),
    },
  };
}
