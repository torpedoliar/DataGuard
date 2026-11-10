"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { devices, epdrEndpoints, watchguardConnections } from "@/db/schema";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";

export type EpdrEndpointRow = {
  id: number;
  hostName: string;
  ipAddress: string | null;
  deviceType: number | null;
  groupPath: string | null;
  accumulatedProtectionStatus: number | null;
  lastSyncedAt: Date;
  deviceId: number | null;
  isCritical: boolean;
  noAuto: boolean;
};

export type EpdrEndpointSummary = {
  total: number;
  protected: number;
  disabled: number;
  error: number;
  installError: number;
  noLicense: number;
  unknown: number;
  offline3: number;
  offline7: number;
  offline30: number;
  stale: boolean;
  lastSyncAt: Date | null;
};

export type EpdrEndpointsData = {
  summary: EpdrEndpointSummary;
  endpoints: EpdrEndpointRow[];
};

function nowMs(): number {
  return Date.now();
}

function offlineDays(lastConnectionAt: Date | null | undefined): number | null {
  if (!lastConnectionAt) return null;
  return (nowMs() - lastConnectionAt.getTime()) / (24 * 60 * 60 * 1000);
}

export async function getEpdrEndpoints(): Promise<EpdrEndpointsData | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };

  const siteId = guard.activeSiteId;
  const rows = await db
    .select({
      id: epdrEndpoints.id,
      hostName: epdrEndpoints.hostName,
      ipAddress: epdrEndpoints.ipAddress,
      deviceType: epdrEndpoints.deviceType,
      groupPath: epdrEndpoints.groupPath,
      accumulatedProtectionStatus: epdrEndpoints.accumulatedProtectionStatus,
      lastSyncedAt: epdrEndpoints.lastSyncedAt,
      lastConnectionAt: epdrEndpoints.lastConnectionAt,
      deviceId: epdrEndpoints.deviceId,
      isCritical: epdrEndpoints.isCritical,
      noAuto: epdrEndpoints.noAuto,
    })
    .from(epdrEndpoints)
    .where(and(eq(epdrEndpoints.siteId, siteId), isNull(epdrEndpoints.removedAt)));

  const summary: EpdrEndpointSummary = {
    total: rows.length,
    protected: 0,
    disabled: 0,
    error: 0,
    installError: 0,
    noLicense: 0,
    unknown: 0,
    offline3: 0,
    offline7: 0,
    offline30: 0,
    stale: false,
    lastSyncAt: null,
  };

  for (const r of rows) {
    const status = r.accumulatedProtectionStatus;
    if (status === 1) summary.protected++;
    else if (status === 2) summary.disabled++;
    else if (status === 3) summary.error++;
    else if (status === 4) summary.installError++;
    else if (status === 5) summary.noLicense++;
    else summary.unknown++;

    const days = offlineDays(r.lastConnectionAt);
    if (days !== null && days > 3) summary.offline3++;
    if (days !== null && days > 7) summary.offline7++;
    if (days !== null && days > 30) summary.offline30++;
  }

  const [conn] = await db
    .select({ lastEndpointSyncAt: watchguardConnections.lastEndpointSyncAt, endpointSyncMinutes: watchguardConnections.endpointSyncMinutes })
    .from(watchguardConnections)
    .where(eq(watchguardConnections.siteId, siteId))
    .limit(1);

  if (conn?.lastEndpointSyncAt) {
    summary.lastSyncAt = conn.lastEndpointSyncAt;
    const limit = (conn.endpointSyncMinutes ?? 15) * 3 * 60 * 1000;
    summary.stale = nowMs() - conn.lastEndpointSyncAt.getTime() > limit;
  }

  return {
    summary,
    endpoints: rows.map((r) => ({
      id: r.id,
      hostName: r.hostName,
      ipAddress: r.ipAddress,
      deviceType: r.deviceType,
      groupPath: r.groupPath,
      accumulatedProtectionStatus: r.accumulatedProtectionStatus,
      lastSyncedAt: r.lastSyncedAt,
      deviceId: r.deviceId,
      isCritical: r.isCritical,
      noAuto: r.noAuto,
    })),
  };
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