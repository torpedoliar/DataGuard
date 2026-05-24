"use server";

import { db } from "@/db";
import { devices, sites, syslogEvents, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

export type SiemSyslogFilters = {
  page?: number;
  pageSize?: number;
  q?: string;
  deviceId?: number;
  sourceIp?: string;
  severity?: number;
  facility?: number;
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
  if (!pageSize || Number.isNaN(pageSize)) return 50;
  return Math.min(Math.max(pageSize, 10), 200);
}

export async function getSiemSyslogData(filters: SiemSyslogFilters = {}) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { messages: [], devices: [], totalMessages: 0, totalPages: 0, currentPage: 1, pageSize: 50, message: auth.message };

  const pageSize = clampPageSize(filters.pageSize);
  const currentPage = Math.max(filters.page ?? 1, 1);
  const offset = (currentPage - 1) * pageSize;
  const startDate = parseDateBoundary(filters.start);
  const endDate = parseDateBoundary(filters.end, true);
  const conditions: SQL[] = [eq(syslogEvents.siteId, auth.activeSiteId)];

  if (filters.deviceId) conditions.push(eq(syslogEvents.deviceId, filters.deviceId));
  if (filters.sourceIp) conditions.push(eq(syslogEvents.sourceIp, filters.sourceIp));
  if (typeof filters.severity === "number" && !Number.isNaN(filters.severity)) conditions.push(eq(syslogEvents.severity, filters.severity));
  if (typeof filters.facility === "number" && !Number.isNaN(filters.facility)) conditions.push(eq(syslogEvents.facility, filters.facility));
  if (startDate) conditions.push(gte(syslogEvents.receivedAt, startDate));
  if (endDate) conditions.push(lte(syslogEvents.receivedAt, endDate));
  if (filters.q) {
    const query = `%${filters.q}%`;
    conditions.push(or(
      ilike(syslogEvents.message, query),
      ilike(syslogEvents.sourceIp, query),
      ilike(syslogEvents.hostname, query),
      ilike(syslogEvents.program, query),
      ilike(syslogEvents.username, query),
    )!);
  }

  const where = and(...conditions);
  const [messages, countRows, deviceRows] = await Promise.all([
    db.select({
      id: syslogEvents.id,
      receivedAt: syslogEvents.receivedAt,
      eventTime: syslogEvents.eventTime,
      sourceIp: syslogEvents.sourceIp,
      hostname: syslogEvents.hostname,
      facility: syslogEvents.facility,
      severity: syslogEvents.severity,
      priority: syslogEvents.priority,
      appName: syslogEvents.appName,
      program: syslogEvents.program,
      message: syslogEvents.message,
      deviceId: syslogEvents.deviceId,
      deviceName: devices.name,
      siteName: sites.name,
      sourceDisplayName: syslogSources.displayName,
      vendor: syslogEvents.vendor,
      category: syslogEvents.category,
      normalizedType: syslogEvents.normalizedType,
    })
      .from(syslogEvents)
      .leftJoin(devices, eq(syslogEvents.deviceId, devices.id))
      .leftJoin(sites, eq(syslogEvents.siteId, sites.id))
      .leftJoin(syslogSources, eq(syslogEvents.sourceId, syslogSources.id))
      .where(where)
      .orderBy(desc(syslogEvents.receivedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(syslogEvents).where(where),
    db.select({ id: devices.id, name: devices.name, ipAddress: devices.ipAddress, assetCode: devices.assetCode })
      .from(devices)
      .where(eq(devices.siteId, auth.activeSiteId))
      .orderBy(devices.name),
  ]);

  const totalMessages = Number(countRows[0]?.count ?? 0);
  return {
    messages,
    devices: deviceRows,
    totalMessages,
    totalPages: Math.ceil(totalMessages / pageSize),
    currentPage,
    pageSize,
  };
}
