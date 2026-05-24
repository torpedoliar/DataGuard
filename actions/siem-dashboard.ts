"use server";

import { db } from "@/db";
import { siemAlerts, siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";

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
  };
}
