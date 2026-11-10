"use server";

import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { epdrDetections, epdrEndpoints, incidents } from "@/db/schema";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { loadSecurityContext, type EpdrSecurityContext } from "./epdr-endpoints";
import { buildThreatTrend, THREAT_CATEGORIES, type ThreatCategory, type TrendDay } from "@/lib/epdr/posture";

export type EpdrDetectionRow = {
  id: number;
  source: string;
  category: string;
  threatName: string | null;
  threatScore: number | null;
  severity: string;
  detectedAt: Date;
  endpointId: number | null;
  hostName: string | null;
  incidentId: number | null;
  incidentStatus: string | null;
  ignoredReason: string | null;
};

export type EpdrThreatsData = EpdrSecurityContext & {
  /** Detections linked to an incident that is still Open / In Progress. */
  activeCount: number;
  categoryTotals: Record<ThreatCategory, { last24h: number; last7d: number }>;
  trend: TrendDay[];
  detections: EpdrDetectionRow[];
  /** Admin-only: stored but not acted on (out of scope, low score, unmapped). */
  ignored: EpdrDetectionRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["Open", "In Progress"]);

export async function getEpdrThreats(): Promise<EpdrThreatsData | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };

  const siteId = guard.activeSiteId;
  const nowMs = Date.now();
  const since = new Date(nowMs - 30 * DAY_MS);

  const select = {
    id: epdrDetections.id,
    source: epdrDetections.source,
    category: epdrDetections.category,
    threatName: epdrDetections.threatName,
    threatScore: epdrDetections.threatScore,
    severity: epdrDetections.severity,
    detectedAt: epdrDetections.detectedAt,
    endpointId: epdrDetections.endpointId,
    hostName: epdrEndpoints.hostName,
    incidentId: epdrDetections.incidentId,
    incidentStatus: incidents.status,
    ignoredReason: epdrDetections.ignoredReason,
  };

  const context = await loadSecurityContext(siteId, guard.session.role);

  const [recent, ignored] = await Promise.all([
    db
      .select(select)
      .from(epdrDetections)
      .leftJoin(epdrEndpoints, and(eq(epdrEndpoints.id, epdrDetections.endpointId), eq(epdrEndpoints.siteId, siteId)))
      .leftJoin(incidents, and(eq(incidents.id, epdrDetections.incidentId), eq(incidents.siteId, siteId)))
      .where(and(eq(epdrDetections.siteId, siteId), isNull(epdrDetections.ignoredReason), gte(epdrDetections.detectedAt, since)))
      .orderBy(desc(epdrDetections.detectedAt))
      .limit(500),
    context.isAdmin
      ? db
          .select(select)
          .from(epdrDetections)
          .leftJoin(epdrEndpoints, and(eq(epdrEndpoints.id, epdrDetections.endpointId), eq(epdrEndpoints.siteId, siteId)))
          .leftJoin(incidents, and(eq(incidents.id, epdrDetections.incidentId), eq(incidents.siteId, siteId)))
          .where(and(eq(epdrDetections.siteId, siteId), isNotNull(epdrDetections.ignoredReason)))
          .orderBy(desc(epdrDetections.detectedAt))
          .limit(100)
      : Promise.resolve([]),
  ]);

  const categoryTotals = Object.fromEntries(
    THREAT_CATEGORIES.map((c) => [c, { last24h: 0, last7d: 0 }]),
  ) as Record<ThreatCategory, { last24h: number; last7d: number }>;

  let activeCount = 0;
  for (const d of recent) {
    const age = nowMs - d.detectedAt.getTime();
    const totals = categoryTotals[d.category as ThreatCategory];
    if (totals) {
      if (age <= DAY_MS) totals.last24h++;
      if (age <= 7 * DAY_MS) totals.last7d++;
    }
    if (d.incidentStatus && ACTIVE_STATUSES.has(d.incidentStatus)) activeCount++;
  }

  return {
    ...context,
    activeCount,
    categoryTotals,
    trend: buildThreatTrend(recent, nowMs, 30),
    detections: recent.slice(0, 200).map((d) => ({ ...d, hostName: d.hostName ?? null, incidentStatus: d.incidentStatus ?? null })),
    ignored: ignored.map((d) => ({ ...d, hostName: d.hostName ?? null, incidentStatus: d.incidentStatus ?? null })),
  };
}
