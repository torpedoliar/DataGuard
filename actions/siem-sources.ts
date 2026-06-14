"use server";

import { db } from "@/db";
import { devices, sites, syslogEvents, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const sourceUpdateSchema = z.object({
  id: z.coerce.number().min(1),
  deviceId: z.coerce.number().nullable().optional(),
  displayName: z.string().min(1, "Display name is required"),
  hostname: z.string().nullable().optional(),
  vendor: z.enum(["generic", "mikrotik", "cisco", "fortigate", "linux", "watchguard"]),
  parserProfile: z.string().min(1, "Parser profile is required"),
  trustLevel: z.enum(["unknown", "trusted", "untrusted"]),
  enabled: z.coerce.boolean(),
  rawRetentionDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  eventRetentionDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
});

export async function getSiemSources() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { sources: [], devices: [], message: auth.message };

  const [sourceRows, deviceRows] = await Promise.all([
    db.select({
      id: syslogSources.id,
      siteId: syslogSources.siteId,
      siteName: sites.name,
      deviceId: syslogSources.deviceId,
      deviceName: devices.name,
      deviceIp: devices.ipAddress,
      sourceIp: syslogSources.sourceIp,
      hostname: syslogSources.hostname,
      displayName: syslogSources.displayName,
      vendor: syslogSources.vendor,
      product: syslogSources.product,
      parserProfile: syslogSources.parserProfile,
      trustLevel: syslogSources.trustLevel,
      enabled: syslogSources.enabled,
      lastSeenAt: syslogSources.lastSeenAt,
      eventCount: syslogSources.eventCount,
      rawRetentionDays: syslogSources.rawRetentionDays,
      eventRetentionDays: syslogSources.eventRetentionDays,
      createdAt: syslogSources.createdAt,
      updatedAt: syslogSources.updatedAt,
    })
      .from(syslogSources)
      .leftJoin(sites, eq(syslogSources.siteId, sites.id))
      .leftJoin(devices, eq(syslogSources.deviceId, devices.id))
      .where(or(eq(syslogSources.siteId, auth.activeSiteId), isNull(syslogSources.siteId)))
      .orderBy(desc(syslogSources.lastSeenAt), desc(syslogSources.createdAt)),
    db.select({
      id: devices.id,
      name: devices.name,
      ipAddress: devices.ipAddress,
      assetCode: devices.assetCode,
    })
      .from(devices)
      .where(eq(devices.siteId, auth.activeSiteId))
      .orderBy(devices.name),
  ]);

  return { sources: sourceRows, devices: deviceRows };
}

export async function updateSiemSource(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = sourceUpdateSchema.safeParse({
    id: formData.get("id"),
    deviceId: formData.get("deviceId") || null,
    displayName: formData.get("displayName"),
    hostname: formData.get("hostname") || null,
    vendor: formData.get("vendor"),
    parserProfile: formData.get("parserProfile"),
    trustLevel: formData.get("trustLevel"),
    enabled: formData.get("enabled") === "true",
    rawRetentionDays: formData.get("rawRetentionDays") || null,
    eventRetentionDays: formData.get("eventRetentionDays") || null,
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const source = await db.query.syslogSources.findFirst({
    where: and(eq(syslogSources.id, parsed.data.id), or(eq(syslogSources.siteId, auth.activeSiteId), isNull(syslogSources.siteId))),
  });
  if (!source) return { message: "Syslog source not found for active site." };

  if (parsed.data.deviceId) {
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, parsed.data.deviceId), eq(devices.siteId, auth.activeSiteId)),
    });
    if (!device) return { message: "Selected device not found for active site." };
  }

  await db.update(syslogSources).set({
    siteId: auth.activeSiteId,
    deviceId: parsed.data.deviceId ?? null,
    displayName: parsed.data.displayName,
    hostname: parsed.data.hostname ?? null,
    vendor: parsed.data.vendor,
    parserProfile: parsed.data.parserProfile,
    trustLevel: parsed.data.trustLevel,
    enabled: parsed.data.enabled,
    rawRetentionDays: parsed.data.rawRetentionDays ?? null,
    eventRetentionDays: parsed.data.eventRetentionDays ?? null,
    updatedAt: new Date(),
  }).where(eq(syslogSources.id, parsed.data.id));

  revalidatePath("/admin/siem/sources");
  await logAudit({ action: "UPDATE", entity: "syslog_source", entityId: parsed.data.id, entityName: parsed.data.displayName });
  return { success: true, message: "SIEM source updated successfully" };
}

const sourceDeleteSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export async function deleteSiemSource(prevState: unknown, formData: FormData) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = sourceDeleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { message: "Invalid source id." };
  const id = parsed.data.id;

  const existing = await db.query.syslogSources.findFirst({
    where: and(eq(syslogSources.id, id), or(eq(syslogSources.siteId, auth.activeSiteId), isNull(syslogSources.siteId))),
  });
  if (!existing) return { message: "Syslog source not found for active site." };

  // Count events that will be detached (preserved with sourceId=null).
  const eventCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(syslogEvents)
    .where(eq(syslogEvents.sourceId, id));
  const detachedCount = eventCountRows[0]?.count ?? 0;

  // Detach events (set sourceId = null) but don't delete them — audit trail.
  await db.update(syslogEvents).set({ sourceId: null }).where(eq(syslogEvents.sourceId, id));
  await db.delete(syslogSources).where(eq(syslogSources.id, id));

  revalidatePath("/admin/siem/sources");
  await logAudit({
    action: "DELETE",
    entity: "syslog_source",
    entityId: id,
    entityName: existing.displayName,
    detail: `Detached ${detachedCount} events`,
  });
  return { success: true, message: "Source deleted. Events retained with sourceId=null." };
}
