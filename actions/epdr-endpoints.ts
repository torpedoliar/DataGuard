"use server";

import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { fleetQuerySchema, fleetOffset, FLEET_PAGE_SIZE, type FleetQuery } from "@/lib/epdr/fleet-query";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { devices, epdrEndpoints, sites, watchguardConnections } from "@/db/schema";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { hasAdminAccess, requireSiteAccess } from "@/lib/site-access";
import {
  bucketForEndpoint,
  OFFLINE_DAYS,
  POSTURE_BUCKETS,
  isOffline,
  postureFromCounts,
  resolveConnectionState,
  summarizeFleet,
  type ConnectionState,
  type FleetPosture,
  type PostureBucket,
  type PostureEndpoint,
} from "@/lib/epdr/posture";

/** Everything the Endpoint Security page renders, already site-scoped. */
export type EpdrEndpointRow = {
  id: number;
  hostName: string;
  ipAddress: string | null;
  deviceType: number | null;
  operatingSystem: string | null;
  groupPath: string | null;
  agentVersion: string | null;
  bucket: PostureBucket;
  accumulatedProtectionStatus: number | null;
  offline: boolean;
  lastConnectionAt: Date | null;
  lastSyncedAt: Date;
  rebootRequested: boolean | null;
  deviceId: number | null;
  assetName: string | null;
  isCritical: boolean;
  noAuto: boolean;
};

export type EpdrSecurityContext = {
  siteName: string;
  connection: ConnectionState;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  isAdmin: boolean;
  isSuperadmin: boolean;
  /** Current account generation; null when no connection is configured. */
  accountRevision: number | null;
};

export type EpdrEndpointsData = EpdrSecurityContext & {
  posture: FleetPosture;
  endpoints: EpdrEndpointRow[];
};

/**
 * Site name, connection lifecycle and the viewer's role — shared by the
 * Endpoint Security and Threats pages so both explain an empty state the
 * same way.
 */
export async function loadSecurityContext(siteId: number, role: string): Promise<EpdrSecurityContext> {
  void role;
  const guard = await requireActiveSiteAction();
  if (!guard.ok || guard.activeSiteId !== siteId || !await requireSiteAccess(siteId)) throw new Error("Unauthorized");
  const [[site], [conn], isAdmin] = await Promise.all([
    db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId)).limit(1),
    db
      .select({
        enabled: watchguardConnections.enabled,
        lastEndpointSyncAt: watchguardConnections.lastEndpointSyncAt,
        endpointSyncMinutes: watchguardConnections.endpointSyncMinutes,
        lastSyncError: watchguardConnections.lastSyncError,
        accountId: watchguardConnections.accountId,
        accountRevision: watchguardConnections.accountRevision,
      })
      .from(watchguardConnections)
      .where(eq(watchguardConnections.siteId, siteId))
      .limit(1),
    hasAdminAccess(),
  ]);

  return {
    siteName: site?.name ?? "",
    connection: resolveConnectionState({
      configured: Boolean(conn?.accountId),
      enabled: conn?.enabled ?? false,
      lastSyncAt: conn?.lastEndpointSyncAt ?? null,
      lastSyncError: conn?.lastSyncError ?? null,
      syncIntervalMinutes: conn?.endpointSyncMinutes ?? 15,
      nowMs: Date.now(),
    }),
    lastSyncAt: conn?.lastEndpointSyncAt ?? null,
    lastSyncError: conn?.lastSyncError ?? null,
    isAdmin,
    isSuperadmin: guard.session.role === "superadmin",
    accountRevision: conn?.accountId ? conn.accountRevision ?? null : null,
  };
}

/** A missing/disabled/unconfigured binding must never broaden a current-fleet read. */
async function loadFleetBinding(siteId: number) {
  const [binding] = await db.select({ id: watchguardConnections.id, accountRevision: watchguardConnections.accountRevision,
    enabled: watchguardConnections.enabled, accountId: watchguardConnections.accountId })
    .from(watchguardConnections).where(eq(watchguardConnections.siteId, siteId)).limit(1);
  return binding?.enabled && binding.accountId?.trim() ? binding : null;
}

export async function getEpdrEndpoints(): Promise<EpdrEndpointsData | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };

  const siteId = guard.activeSiteId;
  if (!await requireSiteAccess(siteId)) return { message: "Unauthorized." };
  const context = await loadSecurityContext(siteId, guard.session.role);
  const binding = await loadFleetBinding(siteId);
  if (!binding) return { ...context, posture: summarizeFleet([]), endpoints: [] };
  const rows = await db
      .select({
        id: epdrEndpoints.id,
        hostName: epdrEndpoints.hostName,
        ipAddress: epdrEndpoints.ipAddress,
        deviceType: epdrEndpoints.deviceType,
        operatingSystem: epdrEndpoints.operatingSystem,
        groupPath: epdrEndpoints.groupPath,
        agentVersion: epdrEndpoints.agentVersion,
        accumulatedProtectionStatus: epdrEndpoints.accumulatedProtectionStatus,
        protectionEngineUpdateStatus: epdrEndpoints.protectionEngineUpdateStatus,
        knowledgeCatalogUpdateStatus: epdrEndpoints.knowledgeCatalogUpdateStatus,
        lastConnectionAt: epdrEndpoints.lastConnectionAt,
        lastSyncedAt: epdrEndpoints.lastSyncedAt,
        rebootRequested: epdrEndpoints.rebootRequested,
        deviceId: epdrEndpoints.deviceId,
        assetName: devices.name,
        isCritical: epdrEndpoints.isCritical,
        noAuto: epdrEndpoints.noAuto,
      })
      .from(epdrEndpoints)
      .leftJoin(devices, and(eq(devices.id, epdrEndpoints.deviceId), eq(devices.siteId, siteId)))
      .where(and(eq(epdrEndpoints.siteId, siteId), isNull(epdrEndpoints.removedAt),
        eq(epdrEndpoints.connectionId, binding.id), eq(epdrEndpoints.accountRevision, binding.accountRevision)))
      .orderBy(asc(epdrEndpoints.hostName));

  const nowMs = Date.now();
  const endpoints: EpdrEndpointRow[] = rows.map((r) => ({
    id: r.id,
    hostName: r.hostName,
    ipAddress: r.ipAddress,
    deviceType: r.deviceType,
    operatingSystem: r.operatingSystem,
    groupPath: r.groupPath,
    agentVersion: r.agentVersion,
    bucket: bucketForEndpoint(r),
    accumulatedProtectionStatus: r.accumulatedProtectionStatus,
    offline: isOffline(r.lastConnectionAt, nowMs),
    lastConnectionAt: r.lastConnectionAt,
    lastSyncedAt: r.lastSyncedAt,
    rebootRequested: r.rebootRequested,
    deviceId: r.deviceId,
    assetName: r.assetName ?? null,
    isCritical: r.isCritical,
    noAuto: r.noAuto,
  }));

  return { ...context, posture: summarizeFleet(endpoints), endpoints };
}

const FLEET_MAP_LIMIT = 300;

const fleetBucketCase = sql<string>`case
  when ${epdrEndpoints.accumulatedProtectionStatus} = 1 then
    case when ${epdrEndpoints.protectionEngineUpdateStatus} = 1 or ${epdrEndpoints.knowledgeCatalogUpdateStatus} = 1 then 'outdated' else 'protected' end
  when ${epdrEndpoints.accumulatedProtectionStatus} = 2 then 'disabled'
  when ${epdrEndpoints.accumulatedProtectionStatus} = 3 then 'error'
  when ${epdrEndpoints.accumulatedProtectionStatus} = 4 then 'install_error'
  when ${epdrEndpoints.accumulatedProtectionStatus} = 5 then 'no_license'
  else 'unknown' end`;

export type EpdrFleetSummary = {
  total: number;
  counts: Record<PostureBucket, number>;
  offline: number;
  unknownContact: number;
  unlinked: number;
  critical: number;
  noAuto: number;
  groups: string[];
  operatingSystems: string[];
  mapLimit: number;
  mapTruncated: boolean;
};
export type EpdrFleetOverview = EpdrSecurityContext & {
  posture: FleetPosture; endpoints: EpdrEndpointRow[]; summary: EpdrFleetSummary;
};

function emptyFleetSummary(): EpdrFleetSummary {
  return {
    total: 0, counts: Object.fromEntries(POSTURE_BUCKETS.map((bucket) => [bucket, 0])) as Record<PostureBucket, number>,
    offline: 0, unknownContact: 0, unlinked: 0, critical: 0, noAuto: 0, groups: [], operatingSystems: [],
    mapLimit: FLEET_MAP_LIMIT, mapTruncated: false,
  };
}

/**
 * Aggregated fleet overview: counts, filter options and a bounded map sample are
 * computed on the server so the page never downloads the whole inventory for
 * summaries. Table rows remain available through the paginated action.
 */
export async function getEpdrFleetOverview(): Promise<EpdrFleetOverview | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  const siteId = guard.activeSiteId;
  if (!await requireSiteAccess(siteId)) return { message: "Unauthorized." };
  const context = await loadSecurityContext(siteId, guard.session.role);
  const binding = await loadFleetBinding(siteId);
  if (!binding) return { ...context, posture: summarizeFleet([]), endpoints: [], summary: emptyFleetSummary() };
  const cutoff = new Date(Date.now() - OFFLINE_DAYS * 86_400_000);
  const scope = sql`${epdrEndpoints.siteId} = ${siteId} AND ${epdrEndpoints.removedAt} IS NULL
    AND ${epdrEndpoints.connectionId} = ${binding.id} AND ${epdrEndpoints.accountRevision} = ${binding.accountRevision}`;

  const [{ rows: aggregateRows }, { rows: mapRows }, { rows: attentionRows }, { rows: optionRows }] = await Promise.all([
    db.execute<{
      total: number; disabled: number; error: number; install_error: number; unknown: number;
      no_license: number; outdated: number; protected: number; offline: number;
      unknown_contact: number; unlinked: number; critical: number; no_auto: number;
    }>(sql`WITH current AS (SELECT ${fleetBucketCase} AS bucket, ${epdrEndpoints.lastConnectionAt} AS last_connection_at,
        ${epdrEndpoints.deviceId} AS device_id, ${epdrEndpoints.isCritical} AS is_critical, ${epdrEndpoints.noAuto} AS no_auto
      FROM ${epdrEndpoints} WHERE ${scope})
      SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE bucket = 'disabled')::integer AS disabled,
        count(*) FILTER (WHERE bucket = 'error')::integer AS error,
        count(*) FILTER (WHERE bucket = 'install_error')::integer AS install_error,
        count(*) FILTER (WHERE bucket = 'unknown')::integer AS unknown,
        count(*) FILTER (WHERE bucket = 'no_license')::integer AS no_license,
        count(*) FILTER (WHERE bucket = 'outdated')::integer AS outdated,
        count(*) FILTER (WHERE bucket = 'protected')::integer AS protected,
        count(*) FILTER (WHERE last_connection_at IS NOT NULL AND last_connection_at < ${cutoff})::integer AS offline,
        count(*) FILTER (WHERE last_connection_at IS NULL)::integer AS unknown_contact,
        count(*) FILTER (WHERE device_id IS NULL)::integer AS unlinked,
        count(*) FILTER (WHERE is_critical)::integer AS critical,
        count(*) FILTER (WHERE no_auto)::integer AS no_auto
      FROM current`),
    db.execute<{
      id: number; hostName: string; ipAddress: string | null; deviceType: number | null; operatingSystem: string | null;
      groupPath: string | null; agentVersion: string | null; bucket: PostureBucket; accumulatedProtectionStatus: number | null;
      offline: boolean; lastConnectionAt: Date | null; lastSyncedAt: Date; rebootRequested: boolean | null;
      deviceId: number | null; assetName: string | null; isCritical: boolean; noAuto: boolean;
    }>(sql`SELECT ${epdrEndpoints.id}, ${epdrEndpoints.hostName} AS "hostName", ${epdrEndpoints.ipAddress} AS "ipAddress",
        ${epdrEndpoints.deviceType} AS "deviceType", ${epdrEndpoints.operatingSystem} AS "operatingSystem",
        ${epdrEndpoints.groupPath} AS "groupPath", ${epdrEndpoints.agentVersion} AS "agentVersion",
        ${fleetBucketCase} AS bucket, ${epdrEndpoints.accumulatedProtectionStatus} AS "accumulatedProtectionStatus",
        (${epdrEndpoints.lastConnectionAt} IS NOT NULL AND ${epdrEndpoints.lastConnectionAt} < ${cutoff}) AS offline,
        ${epdrEndpoints.lastConnectionAt} AS "lastConnectionAt", ${epdrEndpoints.lastSyncedAt} AS "lastSyncedAt",
        ${epdrEndpoints.rebootRequested} AS "rebootRequested", ${epdrEndpoints.deviceId} AS "deviceId",
        ${devices.name} AS "assetName", ${epdrEndpoints.isCritical} AS "isCritical", ${epdrEndpoints.noAuto} AS "noAuto"
      FROM ${epdrEndpoints} LEFT JOIN ${devices} ON ${devices.id} = ${epdrEndpoints.deviceId} AND ${devices.siteId} = ${siteId}
      WHERE ${scope} ORDER BY ${epdrEndpoints.hostName}, ${epdrEndpoints.id} LIMIT ${FLEET_MAP_LIMIT + 1}`),
    db.execute<PostureEndpoint & { lastConnectionAt: Date | null; offline: boolean }>(sql`
      WITH current AS (SELECT ${fleetBucketCase} AS bucket, ${epdrEndpoints.id}, ${epdrEndpoints.hostName} AS "hostName",
        ${epdrEndpoints.deviceType} AS "deviceType", ${epdrEndpoints.isCritical} AS "isCritical",
        ${epdrEndpoints.lastConnectionAt} AS "lastConnectionAt"
      FROM ${epdrEndpoints} WHERE ${scope})
      SELECT id, "hostName", "deviceType", "isCritical", bucket,
        ("lastConnectionAt" IS NOT NULL AND "lastConnectionAt" < ${cutoff}) AS offline, "lastConnectionAt"
      FROM current WHERE bucket IN ('disabled', 'error', 'install_error', 'unknown')
      ORDER BY array_position(ARRAY['disabled', 'error', 'install_error', 'unknown']::text[], bucket),
        ("deviceType" = 3 OR "isCritical") DESC, "lastConnectionAt" ASC NULLS FIRST, id
      LIMIT 50`),
    db.execute<{ kind: string; value: string }>(sql`
      SELECT 'group' AS kind, ${epdrEndpoints.groupPath} AS value FROM ${epdrEndpoints} WHERE ${scope}
        AND ${epdrEndpoints.groupPath} IS NOT NULL AND btrim(${epdrEndpoints.groupPath}) <> ''
      UNION
      SELECT 'os' AS kind, ${epdrEndpoints.operatingSystem} AS value FROM ${epdrEndpoints} WHERE ${scope}
        AND ${epdrEndpoints.operatingSystem} IS NOT NULL AND btrim(${epdrEndpoints.operatingSystem}) <> ''
      ORDER BY 1, 2`),
  ]);

  const aggregate = aggregateRows[0];
  const counts = Object.fromEntries(POSTURE_BUCKETS.map((bucket) => [bucket, Number(aggregate?.[bucket] ?? 0)])) as Record<PostureBucket, number>;
  const total = Number(aggregate?.total ?? 0);
  const summary: EpdrFleetSummary = {
    total, counts, offline: Number(aggregate?.offline ?? 0), unknownContact: Number(aggregate?.unknown_contact ?? 0),
    unlinked: Number(aggregate?.unlinked ?? 0), critical: Number(aggregate?.critical ?? 0), noAuto: Number(aggregate?.no_auto ?? 0),
    groups: optionRows.filter((row) => row.kind === "group").map((row) => row.value),
    operatingSystems: optionRows.filter((row) => row.kind === "os").map((row) => row.value),
    mapLimit: FLEET_MAP_LIMIT, mapTruncated: mapRows.length > FLEET_MAP_LIMIT,
  };
  return {
    ...context,
    posture: postureFromCounts({ total, counts, offline: summary.offline }, attentionRows.map((row) => ({
      id: row.id, hostName: row.hostName, deviceType: row.deviceType, isCritical: row.isCritical,
      bucket: row.bucket, offline: row.offline, lastConnectionAt: row.lastConnectionAt,
    }))),
    endpoints: mapRows.slice(0, FLEET_MAP_LIMIT).map((row) => ({ ...row, offline: row.offline })),
    summary,
  };
}

export type EpdrEndpointPage = { rows: EpdrEndpointRow[]; total: number; page: number; pageSize: number };

/** Bounded table reads; all predicates and the asset join remain site-scoped. */
export async function getEpdrEndpointPage(input: FleetQuery): Promise<EpdrEndpointPage | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  if (!await requireSiteAccess(guard.activeSiteId)) return { message: "Unauthorized." };
  const parsed = fleetQuerySchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid fleet filters." };
  const siteId = guard.activeSiteId;
  const q = parsed.data;
  const binding = await loadFleetBinding(siteId);
  if (!binding) return { rows: [], total: 0, page: 1, pageSize: FLEET_PAGE_SIZE };
  const bucket = sql<string>`case
    when ${epdrEndpoints.accumulatedProtectionStatus} = 1 then
      case when ${epdrEndpoints.protectionEngineUpdateStatus} = 1 or ${epdrEndpoints.knowledgeCatalogUpdateStatus} = 1 then 'outdated' else 'protected' end
    when ${epdrEndpoints.accumulatedProtectionStatus} = 2 then 'disabled'
    when ${epdrEndpoints.accumulatedProtectionStatus} = 3 then 'error'
    when ${epdrEndpoints.accumulatedProtectionStatus} = 4 then 'install_error'
    when ${epdrEndpoints.accumulatedProtectionStatus} = 5 then 'no_license'
    else 'unknown' end`;
  const predicates = [eq(epdrEndpoints.siteId, siteId), isNull(epdrEndpoints.removedAt),
    eq(epdrEndpoints.connectionId, binding.id), eq(epdrEndpoints.accountRevision, binding.accountRevision)];
  if (q.filter === "attention") predicates.push(sql`${bucket} in ('disabled', 'error', 'install_error', 'unknown')`);
  if (q.filter === "outdated") predicates.push(sql`${bucket} = 'outdated'`);
  if (q.filter === "offline") predicates.push(sql`${epdrEndpoints.lastConnectionAt} < ${new Date(Date.now() - OFFLINE_DAYS * 86400000)}`);
  if (q.filter === "unknown_contact") predicates.push(isNull(epdrEndpoints.lastConnectionAt));
  if (q.filter === "unlinked") predicates.push(isNull(epdrEndpoints.deviceId));
  if (q.group) predicates.push(eq(epdrEndpoints.groupPath, q.group));
  if (q.os) predicates.push(eq(epdrEndpoints.operatingSystem, q.os));
  if (q.deviceType) predicates.push(eq(epdrEndpoints.deviceType, Number(q.deviceType)));
  if (q.query) {
    const pattern = `%${q.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    predicates.push(sql`(${epdrEndpoints.hostName} ilike ${pattern} or ${epdrEndpoints.ipAddress} ilike ${pattern})`);
  }
  const where = and(...predicates);
  const [count] = await db.select({ total: sql<number>`count(*)::integer` }).from(epdrEndpoints).where(where);
  const total = Number(count?.total ?? 0);
  const page = Math.min(q.page, Math.max(1, Math.ceil(total / FLEET_PAGE_SIZE)));
  const rows = await db.select({
    id: epdrEndpoints.id, hostName: epdrEndpoints.hostName, ipAddress: epdrEndpoints.ipAddress,
    deviceType: epdrEndpoints.deviceType, operatingSystem: epdrEndpoints.operatingSystem,
    groupPath: epdrEndpoints.groupPath, agentVersion: epdrEndpoints.agentVersion,
    accumulatedProtectionStatus: epdrEndpoints.accumulatedProtectionStatus,
    protectionEngineUpdateStatus: epdrEndpoints.protectionEngineUpdateStatus,
    knowledgeCatalogUpdateStatus: epdrEndpoints.knowledgeCatalogUpdateStatus,
    lastConnectionAt: epdrEndpoints.lastConnectionAt, lastSyncedAt: epdrEndpoints.lastSyncedAt,
    rebootRequested: epdrEndpoints.rebootRequested, deviceId: epdrEndpoints.deviceId,
    assetName: devices.name, isCritical: epdrEndpoints.isCritical, noAuto: epdrEndpoints.noAuto,
  }).from(epdrEndpoints)
    .leftJoin(devices, and(eq(devices.id, epdrEndpoints.deviceId), eq(devices.siteId, siteId)))
    .where(where)
    .orderBy(q.sort === "contact" ? sql`${epdrEndpoints.lastConnectionAt} desc nulls last` : asc(epdrEndpoints.hostName), asc(epdrEndpoints.id))
    .limit(FLEET_PAGE_SIZE).offset(fleetOffset({ ...q, page }));
  const nowMs = Date.now();
  return { rows: rows.map((r) => ({ ...r, bucket: bucketForEndpoint(r), offline: isOffline(r.lastConnectionAt, nowMs) })), total, page, pageSize: FLEET_PAGE_SIZE };
}

/** Same-site asset search for the "link to asset" picker (admin only). */
export async function searchSiteAssets(query: string): Promise<{ id: number; name: string; ipAddress: string | null }[]> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok || !await requireSiteAccess(guard.activeSiteId)) return [];
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return db
    .select({ id: devices.id, name: devices.name, ipAddress: devices.ipAddress })
    .from(devices)
    .where(and(eq(devices.siteId, guard.activeSiteId), or(ilike(devices.name, pattern), ilike(devices.ipAddress, pattern), ilike(devices.assetCode, pattern))))
    .orderBy(asc(devices.name))
    .limit(8);
}

const endpointIdSchema = z.object({ endpointId: z.coerce.number().int().positive() });
const linkSchema = z.object({ endpointId: z.coerce.number().int().positive(), deviceId: z.coerce.number().int().positive() });
const toggleSchema = z.object({ endpointId: z.coerce.number().int().positive(), value: z.boolean() });

export async function linkEpdrEndpointToAsset(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!await requireSiteAccess(guard.activeSiteId)) return { message: "Unauthorized." };
  const parsed = linkSchema.safeParse({
    endpointId: String(formData.get("endpointId") ?? ""),
    deviceId: String(formData.get("deviceId") ?? ""),
  });
  if (!parsed.success) return { message: "Endpoint atau aset tidak valid." };

  const siteId = guard.activeSiteId;
  const [endpoint] = await db.select({ siteId: epdrEndpoints.siteId }).from(epdrEndpoints).where(eq(epdrEndpoints.id, parsed.data.endpointId)).limit(1);
  if (!endpoint || endpoint.siteId !== siteId) return { message: "Endpoint tidak ditemukan untuk site ini." };

  const [device] = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, parsed.data.deviceId), eq(devices.siteId, siteId))).limit(1);
  if (!device) return { message: "Aset harus berada di site yang sama." };

  await db.update(epdrEndpoints).set({ deviceId: device.id }).where(eq(epdrEndpoints.id, parsed.data.endpointId));
  revalidatePath("/admin/epdr");
  await logAudit({ action: "UPDATE", entity: "device", entityId: device.id, entityName: "EPDR Endpoint link", detail: `Endpoint #${parsed.data.endpointId} linked to asset` });
  return { success: true, message: "Endpoint ditautkan ke aset." };
}

export async function unlinkEpdrEndpoint(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!await requireSiteAccess(guard.activeSiteId)) return { message: "Unauthorized." };
  const parsed = endpointIdSchema.safeParse({ endpointId: String(formData.get("endpointId") ?? "") });
  if (!parsed.success) return { message: "Endpoint tidak valid." };

  const [endpoint] = await db.select({ siteId: epdrEndpoints.siteId, deviceId: epdrEndpoints.deviceId }).from(epdrEndpoints).where(eq(epdrEndpoints.id, parsed.data.endpointId)).limit(1);
  if (!endpoint || endpoint.siteId !== guard.activeSiteId) return { message: "Endpoint tidak ditemukan." };

  await db.update(epdrEndpoints).set({ deviceId: null }).where(eq(epdrEndpoints.id, parsed.data.endpointId));
  revalidatePath("/admin/epdr");
  return { success: true, message: "Tautan aset dilepas." };
}

export async function setEpdrEndpointCritical(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!await requireSiteAccess(guard.activeSiteId)) return { message: "Unauthorized." };
  const parsed = toggleSchema.safeParse({
    endpointId: String(formData.get("endpointId") ?? ""),
    value: String(formData.get("value") ?? "") === "true" || String(formData.get("value") ?? "") === "on",
  });
  if (!parsed.success) return { message: "Input tidak valid." };

  const [endpoint] = await db.select({ siteId: epdrEndpoints.siteId }).from(epdrEndpoints).where(eq(epdrEndpoints.id, parsed.data.endpointId)).limit(1);
  if (!endpoint || endpoint.siteId !== guard.activeSiteId) return { message: "Endpoint tidak ditemukan." };

  await db.update(epdrEndpoints).set({ isCritical: parsed.data.value }).where(eq(epdrEndpoints.id, parsed.data.endpointId));
  revalidatePath("/admin/epdr");
  return { success: true, message: "Flag critical diperbarui." };
}

export async function setEpdrEndpointNoAuto(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!await requireSiteAccess(guard.activeSiteId)) return { message: "Unauthorized." };
  const parsed = toggleSchema.safeParse({
    endpointId: String(formData.get("endpointId") ?? ""),
    value: String(formData.get("value") ?? "") === "true" || String(formData.get("value") ?? "") === "on",
  });
  if (!parsed.success) return { message: "Input tidak valid." };

  const [endpoint] = await db.select({ siteId: epdrEndpoints.siteId }).from(epdrEndpoints).where(eq(epdrEndpoints.id, parsed.data.endpointId)).limit(1);
  if (!endpoint || endpoint.siteId !== guard.activeSiteId) return { message: "Endpoint tidak ditemukan." };

  await db.update(epdrEndpoints).set({ noAuto: parsed.data.value }).where(eq(epdrEndpoints.id, parsed.data.endpointId));
  revalidatePath("/admin/epdr");
  return { success: true, message: "Flag no-auto diperbarui." };
}