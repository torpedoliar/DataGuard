"use server";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { epdrDetections, epdrEndpoints, sites, watchguardConnections } from "@/db/schema";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { requireSiteAccess } from "@/lib/site-access";
import { PLAYBOOK_TEMPLATES, PLAYBOOK_FRESHNESS_MS, evaluatePlaybook, type PlaybookResult } from "@/lib/epdr/playbooks";
import { detectionCompleteness, type DetectionReadEvidence } from "@/lib/epdr/detection-evidence";

export type PlaybookPreview = {
  siteId: number;
  siteName: string;
  sampledAt: string;
  since: string;
  limit: number;
  truncated: boolean;
  healthAvailable: false;
  detectionCompleteness: "unavailable" | "source_specific";
  rows: { id: number; source: string; category: string; score: number | null; evaluations: { templateId: string; result: PlaybookResult }[] }[];
};

/** Explicit read only. No provider client, worker, mutation or raw payload is imported. */
export async function previewEpdrPlaybooks(): Promise<PlaybookPreview | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  const siteId = guard.activeSiteId;
  if (!await requireSiteAccess(siteId)) return { message: "Unauthorized." };
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const limit = 100;
  const [site] = await db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) return { message: "Site unavailable." };
  const rows = await db.select({
    id: epdrDetections.id, source: epdrDetections.source, category: epdrDetections.category,
    score: epdrDetections.threatScore, detectedAt: epdrDetections.detectedAt,
    endpointId: epdrEndpoints.id, providerId: epdrEndpoints.wgDeviceId,
    removedAt: epdrEndpoints.removedAt,
    connectionId: watchguardConnections.id, accountRevision: watchguardConnections.accountRevision,
    credentialRevision: watchguardConnections.credentialRevision,
  }).from(epdrDetections)
    .innerJoin(watchguardConnections, and(
      eq(watchguardConnections.id, epdrDetections.connectionId), eq(watchguardConnections.siteId, siteId),
      eq(watchguardConnections.accountRevision, epdrDetections.accountRevision), eq(watchguardConnections.enabled, true),
    ))
    .leftJoin(epdrEndpoints, and(eq(epdrEndpoints.id, epdrDetections.endpointId), eq(epdrEndpoints.siteId, siteId), eq(epdrEndpoints.connectionId, epdrDetections.connectionId), eq(epdrEndpoints.accountRevision, epdrDetections.accountRevision)))
    .where(and(eq(epdrDetections.siteId, siteId), gte(epdrDetections.detectedAt, since), lte(epdrDetections.detectedAt, now)))
    .orderBy(desc(epdrDetections.detectedAt), desc(epdrDetections.id)).limit(limit + 1);
  type EvidenceRow = DetectionReadEvidence & { enabled: boolean; settingsChangedAt: Date | null };
  const { rows: attempts } = await db.execute<EvidenceRow>(sql`
    SELECT DISTINCT ON (e.source) e.connection_id AS "connectionId", e.account_revision AS "accountRevision",
      e.credential_revision AS "credentialRevision", e.source, e.status, e.window,
      e.started_at AS "startedAt", e.finished_at AS "finishedAt", e.event_types AS "eventTypes",
      e.completed_event_types AS "completedEventTypes", e.settings_updated_at AS "settingsUpdatedAt", s.updated_at AS "settingsChangedAt",
      CASE WHEN e.source = 'threatsync' THEN coalesce(s.threatsync_enabled, true)
        ELSE coalesce(s.ingest_enabled, false) END AS enabled
    FROM epdr_detection_read_evidence e JOIN watchguard_connections c ON c.id = e.connection_id
      AND c.account_revision = e.account_revision AND c.credential_revision = e.credential_revision
    LEFT JOIN epdr_site_settings s ON s.site_id = c.site_id
    WHERE c.site_id = ${siteId} AND c.enabled = true
    ORDER BY e.source, e.started_at DESC, e.id DESC`);
  const evidenceFor = (row: typeof rows[number]) => {
    const source = row.source;
    const evidence = attempts.find((attempt) => attempt.source === source && attempt.connectionId === row.connectionId
      && attempt.accountRevision === row.accountRevision && attempt.credentialRevision === row.credentialRevision);
    if (!evidence || (source !== "threatsync" && source !== "event_export")) {
      return { completeness: { source, status: "unknown" as const }, syncedAt: null };
    }
    return detectionCompleteness(evidence, {
      connectionId: evidence.connectionId, accountRevision: evidence.accountRevision,
      credentialRevision: evidence.credentialRevision, source,
      enabled: evidence.enabled, settingsUpdatedAt: evidence.settingsChangedAt,
      now: now.getTime(), maxAgeMs: PLAYBOOK_FRESHNESS_MS,
    });
  };
  return {
    siteId, siteName: site.name, sampledAt: now.toISOString(), since: since.toISOString(), limit,
    truncated: rows.length > limit, healthAvailable: false, detectionCompleteness: attempts.length ? "source_specific" : "unavailable",
    rows: rows.slice(0, limit).map((row) => ({
      id: row.id, source: row.source, category: row.category, score: row.score,
      evaluations: PLAYBOOK_TEMPLATES.map((template) => ({ templateId: template.id, result: evaluatePlaybook(template, {
        source: row.source, category: row.category, score: row.score,
        identityKnown: row.endpointId !== null && Boolean(row.providerId?.trim()) && row.removedAt === null,
        ...evidenceFor(row),
        observedAt: row.detectedAt.getTime(),
      }, now.getTime(), true) })),
    })),
  };
}
