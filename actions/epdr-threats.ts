"use server";

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { epdrDetections, epdrEndpoints, incidents, watchguardConnections } from "@/db/schema";
import { requireSiteAccess } from "@/lib/site-access";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { loadSecurityContext, type EpdrSecurityContext } from "./epdr-endpoints";
import { buildThreatTrend, THREAT_CATEGORIES, type ThreatCategory, type TrendDay } from "@/lib/epdr/posture";
import { THREAT_DAY_MS, THREAT_PAGE_SIZE, threatEndpointJoin, threatOffset, threatOrder, threatQuerySchema, threatWhere, type ThreatQuery } from "@/lib/epdr/threat-query";

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
  /** Observed under an earlier account revision; identity is not re-verified. */
  historical: boolean;
};
export type EpdrThreatPage = { rows: EpdrDetectionRow[]; total: number; page: number; pageSize: number };
export type EpdrThreatsData = EpdrSecurityContext & {
  /** Distinct linked incidents still Open / In Progress in the 30-day window. */
  activeCount: number;
  categoryTotals: Record<ThreatCategory, { last24h: number; last7d: number }>;
  trend: TrendDay[];
  detections: EpdrDetectionRow[];
  ignored: EpdrDetectionRow[];
  detectionPage: EpdrThreatPage;
  ignoredPage: EpdrThreatPage;
};

async function currentRevision(siteId: number): Promise<number | null> {
  const [row] = await db.select({ accountRevision: watchguardConnections.accountRevision })
    .from(watchguardConnections).where(eq(watchguardConnections.siteId, siteId)).limit(1);
  return row?.accountRevision ?? null;
}

async function readPage(siteId: number, query: ThreatQuery, now: Date, revision: number | null): Promise<EpdrThreatPage> {
  const where = threatWhere(siteId, query, now);
  const select = {
    id: epdrDetections.id, source: epdrDetections.source, category: epdrDetections.category,
    threatName: epdrDetections.threatName, threatScore: epdrDetections.threatScore,
    severity: epdrDetections.severity, detectedAt: epdrDetections.detectedAt,
    accountRevision: epdrDetections.accountRevision,
    endpointId: epdrEndpoints.id, hostName: epdrEndpoints.hostName,
    incidentId: incidents.id, incidentStatus: incidents.status, ignoredReason: epdrDetections.ignoredReason,
  };
  const [rows, counts] = await Promise.all([
    db.select(select).from(epdrDetections)
      .leftJoin(epdrEndpoints, threatEndpointJoin(siteId))
      .leftJoin(incidents, and(eq(incidents.id, epdrDetections.incidentId), eq(incidents.siteId, siteId)))
      .where(where).orderBy(...threatOrder(query)).limit(THREAT_PAGE_SIZE).offset(threatOffset(query)),
    db.select({ total: sql<number>`count(*)::int` }).from(epdrDetections)
      .leftJoin(epdrEndpoints, threatEndpointJoin(siteId)).where(where),
  ]);
  return {
    rows: rows.map(({ accountRevision, ...row }) => ({ ...row, historical: revision !== null && typeof accountRevision === "number" && accountRevision !== revision })),
    total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: THREAT_PAGE_SIZE,
  };
}

/** Read-only table action: every request rechecks active-site membership. */
export async function getEpdrThreatTable(input: unknown = {}): Promise<EpdrThreatPage | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  if (!await requireSiteAccess(guard.activeSiteId)) return { message: "Unauthorized." };
  const parsed = threatQuerySchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid threat query." };
  if (parsed.data.ignored) {
    const context = await loadSecurityContext(guard.activeSiteId, guard.session.role);
    if (!context.isAdmin) return { message: "Unauthorized." };
  }
  return readPage(guard.activeSiteId, parsed.data, new Date(), await currentRevision(guard.activeSiteId));
}

export async function getEpdrThreats(): Promise<EpdrThreatsData | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  const siteId = guard.activeSiteId;
  if (!await requireSiteAccess(siteId)) return { message: "Unauthorized." };
  const now = new Date();
  const [context, revision] = await Promise.all([
    loadSecurityContext(siteId, guard.session.role),
    currentRevision(siteId),
  ]);
  const where = and(eq(epdrDetections.siteId, siteId), isNull(epdrDetections.ignoredReason),
    gte(epdrDetections.detectedAt, new Date(now.getTime() - 30 * THREAT_DAY_MS)), lte(epdrDetections.detectedAt, now));
  const day = sql<string>`to_char(${epdrDetections.detectedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [detectionPage, ignoredPage, categories, daily, active] = await Promise.all([
    readPage(siteId, threatQuerySchema.parse({}), now, revision),
    context.isAdmin ? readPage(siteId, threatQuerySchema.parse({ ignored: true }), now, revision) : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: THREAT_PAGE_SIZE }),
    db.select({ category: epdrDetections.category,
      last24h: sql<number>`count(*) filter (where ${epdrDetections.detectedAt} >= ${new Date(now.getTime() - THREAT_DAY_MS)})::int`,
      last7d: sql<number>`count(*) filter (where ${epdrDetections.detectedAt} >= ${new Date(now.getTime() - 7 * THREAT_DAY_MS)})::int`,
    }).from(epdrDetections).where(where).groupBy(epdrDetections.category),
    db.select({ date: day, category: epdrDetections.category, total: sql<number>`count(*)::int` })
      .from(epdrDetections).where(where).groupBy(day, epdrDetections.category),
    db.select({ total: sql<number>`count(distinct ${incidents.id}) filter (where ${incidents.status} in ('Open', 'In Progress'))::int` })
      .from(epdrDetections).leftJoin(incidents, and(eq(incidents.id, epdrDetections.incidentId), eq(incidents.siteId, siteId))).where(where),
  ]);
  const categoryTotals = Object.fromEntries(THREAT_CATEGORIES.map((c) => [c, { last24h: 0, last7d: 0 }])) as EpdrThreatsData["categoryTotals"];
  for (const row of categories) {
    if (THREAT_CATEGORIES.includes(row.category as ThreatCategory)) categoryTotals[row.category as ThreatCategory] = { last24h: Number(row.last24h), last7d: Number(row.last7d) };
  }
  const trend = buildThreatTrend([], now.getTime(), 30);
  for (const row of daily) {
    const bucket = trend.find((d) => d.date === row.date);
    if (bucket && THREAT_CATEGORIES.includes(row.category as ThreatCategory)) {
      bucket.counts[row.category as ThreatCategory] += Number(row.total);
      bucket.total += Number(row.total);
    }
  }
  return { ...context, activeCount: Number(active[0]?.total ?? 0), categoryTotals, trend,
    detections: detectionPage.rows, ignored: ignoredPage.rows, detectionPage, ignoredPage };
}
