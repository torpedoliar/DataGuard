"use server";

import { db } from "@/db";
import { devices, siemEventsQuarantine, sites, syslogEvents, syslogEventsRaw, syslogSources } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireActiveSiteAdminAction, requireSuperadminAction } from "@/lib/action-auth";
import { inspectRawLogInjection } from "@/lib/siem/injection-inspector";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";

export type SiemEventFilters = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: "received" | "parsed" | "parse_failed" | "dropped";
  category?: string;
  normalizedType?: string;
  severity?: number;
  sourceIp?: string;
  eventIds?: number[];
  start?: string;
  end?: string;
};

function parseDateBoundary(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function clampPageSize(pageSize: number | undefined) {
  if (!pageSize || Number.isNaN(pageSize)) return 25;
  return Math.min(Math.max(pageSize, 10), 100);
}

export async function getSiemEventExplorerData(filters: SiemEventFilters) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { events: [], rawEvents: [], totalEvents: 0, totalRawEvents: 0, totalPages: 0, currentPage: 1, pageSize: 25, message: auth.message };

  const pageSize = clampPageSize(filters.pageSize);
  const currentPage = Math.max(filters.page ?? 1, 1);
  const offset = (currentPage - 1) * pageSize;
  const startDate = parseDateBoundary(filters.start);
  const endDate = parseDateBoundary(filters.end, true);

  const eventConditions: SQL[] = [eq(syslogEvents.siteId, auth.activeSiteId)];
  if (filters.category) eventConditions.push(eq(syslogEvents.category, filters.category));
  if (filters.normalizedType) eventConditions.push(eq(syslogEvents.normalizedType, filters.normalizedType));
  if (typeof filters.severity === "number" && !Number.isNaN(filters.severity)) eventConditions.push(eq(syslogEvents.severity, filters.severity));
  if (filters.sourceIp) eventConditions.push(eq(syslogEvents.sourceIp, filters.sourceIp));
  if (filters.eventIds?.length) eventConditions.push(inArray(syslogEvents.id, filters.eventIds));
  if (startDate) eventConditions.push(gte(syslogEvents.receivedAt, startDate));
  if (endDate) eventConditions.push(lte(syslogEvents.receivedAt, endDate));
  if (filters.q) {
    const query = `%${filters.q}%`;
    eventConditions.push(or(
      ilike(syslogEvents.message, query),
      ilike(syslogEvents.sourceIp, query),
      ilike(syslogEvents.hostname, query),
      ilike(syslogEvents.username, query),
    )!);
  }

  const sourceRows = await db.select({ sourceIp: syslogSources.sourceIp }).from(syslogSources).where(eq(syslogSources.siteId, auth.activeSiteId));
  const sourceIps = [...new Set(sourceRows.map((source) => source.sourceIp))];
  const rawConditions: SQL[] = sourceIps.length > 0 ? [inArray(syslogEventsRaw.sourceIp, sourceIps)] : [sql`false`];
  if (filters.status) rawConditions.push(eq(syslogEventsRaw.ingestStatus, filters.status));
  if (filters.sourceIp) rawConditions.push(eq(syslogEventsRaw.sourceIp, filters.sourceIp));
  if (startDate) rawConditions.push(gte(syslogEventsRaw.receivedAt, startDate));
  if (endDate) rawConditions.push(lte(syslogEventsRaw.receivedAt, endDate));
  if (filters.q) rawConditions.push(or(ilike(syslogEventsRaw.rawMessage, `%${filters.q}%`), ilike(syslogEventsRaw.sourceIp, `%${filters.q}%`))!);

  const eventWhere = and(...eventConditions);
  const rawWhere = and(...rawConditions);

  const [events, eventCountRows, rawEvents, rawCountRows] = await Promise.all([
    db.select({
      id: syslogEvents.id,
      rawEventId: syslogEvents.rawEventId,
      eventTime: syslogEvents.eventTime,
      receivedAt: syslogEvents.receivedAt,
      sourceIp: syslogEvents.sourceIp,
      hostname: syslogEvents.hostname,
      severity: syslogEvents.severity,
      facility: syslogEvents.facility,
      priority: syslogEvents.priority,
      appName: syslogEvents.appName,
      program: syslogEvents.program,
      message: syslogEvents.message,
      siteName: sites.name,
      deviceName: devices.name,
      sourceDisplayName: syslogSources.displayName,
      vendor: syslogEvents.vendor,
      parser: syslogEvents.parser,
      category: syslogEvents.category,
      normalizedType: syslogEvents.normalizedType,
      action: syslogEvents.action,
      outcome: syslogEvents.outcome,
      srcIp: syslogEvents.srcIp,
      dstIp: syslogEvents.dstIp,
      username: syslogEvents.username,
      interfaceName: syslogEvents.interfaceName,
      tags: syslogEvents.tags,
      rawMessage: syslogEventsRaw.rawMessage,
    })
      .from(syslogEvents)
      .leftJoin(sites, eq(syslogEvents.siteId, sites.id))
      .leftJoin(devices, eq(syslogEvents.deviceId, devices.id))
      .leftJoin(syslogSources, eq(syslogEvents.sourceId, syslogSources.id))
      .leftJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
      .where(eventWhere)
      .orderBy(desc(syslogEvents.receivedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(syslogEvents).where(eventWhere),
    db.select({
      id: syslogEventsRaw.id,
      receivedAt: syslogEventsRaw.receivedAt,
      sourceIp: syslogEventsRaw.sourceIp,
      sourcePort: syslogEventsRaw.sourcePort,
      transport: syslogEventsRaw.transport,
      rawMessage: syslogEventsRaw.rawMessage,
      rawSize: syslogEventsRaw.rawSize,
      ingestStatus: syslogEventsRaw.ingestStatus,
      parseError: syslogEventsRaw.parseError,
    })
      .from(syslogEventsRaw)
      .where(rawWhere)
      .orderBy(desc(syslogEventsRaw.receivedAt))
      .limit(20),
    db.select({ count: sql<number>`count(*)::int` }).from(syslogEventsRaw).where(rawWhere),
  ]);

  const eventsWithInspection = events.map((event) => ({
    ...event,
    injectionIndicators: inspectRawLogInjection(event.rawMessage ?? event.message),
  }));
  const rawWithInspection = rawEvents.map((event) => ({
    ...event,
    injectionIndicators: inspectRawLogInjection(event.rawMessage),
  }));
  const totalEvents = eventCountRows[0]?.count ?? 0;
  const totalRawEvents = rawCountRows[0]?.count ?? 0;

  return {
    events: eventsWithInspection,
    rawEvents: rawWithInspection,
    totalEvents,
    totalRawEvents,
    totalPages: Math.ceil(totalEvents / pageSize),
    currentPage,
    pageSize,
  };
}

/**
 * Returns the number of quarantined events older than 24h. Transient rows from
 * a recent cleanup pass are excluded so the UI count is stable.
 * Admin-only.
 */
export async function getQuarantinedEventsCount(): Promise<{ ok: boolean; count?: number; message?: string }> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { ok: false, message: auth.message };

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(siemEventsQuarantine)
    .where(lt(siemEventsQuarantine.quarantinedAt, cutoff));
  return { ok: true, count: rows[0]?.count ?? 0 };
}

export type PruneEventsResult = {
  ok: boolean;
  message?: string;
  deletedEvents?: number;
  deletedRaw?: number;
  cutoffDate?: string;
};

/**
 * Manually delete parsed syslog events (and optionally orphan raw events) received
 * before `cutoffDate`. Superadmin only. Batched delete with 10k row chunks so a
 * large purge can never hold a long-running lock. Logs the action to the audit
 * trail with the cutoff and the per-table counts.
 *
 * Options:
 * - `rawEventsOnly`  : also delete orphan raw events older than the cutoff
 *                      (rows that no parsed event references). Default: false.
 * - `siteScoped`     : limit the parsed-events delete to the caller's active site.
 *                      Default: true.
 */
export async function pruneEventsBefore(
  cutoffDate: string,
  options: { rawEventsOnly?: boolean; siteScoped?: boolean } = {},
): Promise<PruneEventsResult> {
  const auth = await requireSuperadminAction();
  if (!auth.ok) return { ok: false, message: auth.message };

  const date = new Date(cutoffDate);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, message: "Invalid date" };
  }

  const batchSize = 10_000;
  const { rawEventsOnly = false, siteScoped = true } = options;

  // ----- Phase 1: delete parsed syslog_events in batches -----
  let deletedEvents = 0;
  let done = false;
  while (!done) {
    const conditions: SQL[] = [lt(syslogEvents.receivedAt, date)];
    if (siteScoped && auth.activeSiteId) {
      conditions.push(eq(syslogEvents.siteId, auth.activeSiteId));
    }
    const victims = await db
      .select({ id: syslogEvents.id })
      .from(syslogEvents)
      .where(and(...conditions))
      .limit(batchSize);
    if (victims.length === 0) {
      done = true;
    } else {
      const ids = victims.map((row) => row.id);
      const result = await db
        .delete(syslogEvents)
        .where(inArray(syslogEvents.id, ids));
      // drizzle returns an array-like with .length for the affected row count
      const affected = Array.isArray(result) ? result.length : (result as unknown as { rowCount?: number }).rowCount ?? ids.length;
      deletedEvents += affected;
      if (victims.length < batchSize) done = true;
    }
  }

  // ----- Phase 2: optionally delete orphan raw events -----
  let deletedRaw = 0;
  if (rawEventsOnly) {
    const rawDeleted = await db
      .delete(syslogEventsRaw)
      .where(
        and(
          lt(syslogEventsRaw.receivedAt, date),
          sql`not exists (select 1 from ${syslogEvents} where ${syslogEvents.rawEventId} = ${syslogEventsRaw.id})`,
        ),
      )
      .returning({ id: syslogEventsRaw.id });
    deletedRaw = rawDeleted.length;
  }

  await logAudit({
    action: "DELETE",
    entity: "syslog_event",
    detail: `Manual prune cutoff=${cutoffDate} deletedEvents=${deletedEvents} deletedRawOrphans=${deletedRaw} rawEventsOnly=${rawEventsOnly} siteScoped=${siteScoped}`,
  });

  return { ok: true, deletedEvents, deletedRaw, cutoffDate };
}
