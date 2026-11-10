"use server";

import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { devices, epdrEndpoints, sites, watchguardConnections } from "@/db/schema";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { hasAdminAccess } from "@/lib/site-access";
import {
  bucketForEndpoint,
  isOffline,
  resolveConnectionState,
  summarizeFleet,
  type ConnectionState,
  type FleetPosture,
  type PostureBucket,
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
  const [[site], [conn], isAdmin] = await Promise.all([
    db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId)).limit(1),
    db
      .select({
        enabled: watchguardConnections.enabled,
        lastEndpointSyncAt: watchguardConnections.lastEndpointSyncAt,
        endpointSyncMinutes: watchguardConnections.endpointSyncMinutes,
        lastSyncError: watchguardConnections.lastSyncError,
        accountId: watchguardConnections.accountId,
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
    isSuperadmin: role === "superadmin",
  };
}

export async function getEpdrEndpoints(): Promise<EpdrEndpointsData | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };

  const siteId = guard.activeSiteId;
  const [context, rows] = await Promise.all([
    loadSecurityContext(siteId, guard.session.role),
    db
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
      .where(and(eq(epdrEndpoints.siteId, siteId), isNull(epdrEndpoints.removedAt)))
      .orderBy(asc(epdrEndpoints.hostName)),
  ]);

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

/** Same-site asset search for the "link to asset" picker (admin only). */
export async function searchSiteAssets(query: string): Promise<{ id: number; name: string; ipAddress: string | null }[]> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return [];
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