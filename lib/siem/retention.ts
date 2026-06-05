import { db } from "../../db";
import { siemAlerts, siemFindings, siemSettings, syslogEvents, syslogEventsRaw } from "../../db/schema";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_SIEM_RETENTION_DAYS = {
  raw: 90,
  events: 180,
  findings: 365,
  alerts: 365,
};

type RetentionSettings = {
  rawRetentionDays: number | null;
  eventRetentionDays: number | null;
  findingRetentionDays: number | null;
  alertRetentionDays: number | null;
};

export type SiemRetentionCutoffs = {
  raw: Date;
  events: Date;
  findings: Date;
  alerts: Date;
};

export type SiemRetentionCleanupResult = {
  rawEventsDeleted: number;
  eventsDeleted: number;
  findingsDeleted: number;
  alertsDeleted: number;
};

export function normalizeRetentionDays(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

/** A source's effective retention days: its override if valid, else the global default. */
export function resolveSourceCutoffDays(override: number | null | undefined, globalDays: number): number {
  if (!Number.isFinite(override) || !override || (override as number) < 1) return globalDays;
  return Math.floor(override as number);
}

/**
 * The cutoff date below which a whole partition may be dropped: now minus the
 * LARGEST retention across all sources (and the global default). Any data older
 * than this is expired for every source, so the partition is safe to drop.
 */
export function mostLenientEventCutoff(
  sources: Array<{ eventRetentionDays: number | null }>,
  globalDays: number,
  now: Date,
): Date {
  let maxDays = globalDays;
  for (const source of sources) {
    maxDays = Math.max(maxDays, resolveSourceCutoffDays(source.eventRetentionDays, globalDays));
  }
  return new Date(now.getTime() - maxDays * MS_PER_DAY);
}

function cutoff(now: Date, days: number) {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

export function buildSiemRetentionCutoffs(settings: Partial<RetentionSettings> | null | undefined, now = new Date()): SiemRetentionCutoffs {
  return {
    raw: cutoff(now, normalizeRetentionDays(settings?.rawRetentionDays, DEFAULT_SIEM_RETENTION_DAYS.raw)),
    events: cutoff(now, normalizeRetentionDays(settings?.eventRetentionDays, DEFAULT_SIEM_RETENTION_DAYS.events)),
    findings: cutoff(now, normalizeRetentionDays(settings?.findingRetentionDays, DEFAULT_SIEM_RETENTION_DAYS.findings)),
    alerts: cutoff(now, normalizeRetentionDays(settings?.alertRetentionDays, DEFAULT_SIEM_RETENTION_DAYS.alerts)),
  };
}

export async function runSiemRetentionCleanup(options: { now?: Date; batchSize?: number } = {}): Promise<SiemRetentionCleanupResult> {
  const batchSize = Math.max(1, Math.min(Math.floor(options.batchSize ?? 1000), 10000));
  const [settings] = await db.select({
    rawRetentionDays: siemSettings.rawRetentionDays,
    eventRetentionDays: siemSettings.eventRetentionDays,
    findingRetentionDays: siemSettings.findingRetentionDays,
    alertRetentionDays: siemSettings.alertRetentionDays,
  }).from(siemSettings).limit(1);
  const cutoffs = buildSiemRetentionCutoffs(settings, options.now ?? new Date());

  const oldAlerts = await db.delete(siemAlerts)
    .where(lt(siemAlerts.createdAt, cutoffs.alerts))
    .returning({ id: siemAlerts.id });

  const staleFindings = await db.select({ id: siemFindings.id }).from(siemFindings)
    .where(and(eq(siemFindings.status, "Resolved"), lt(siemFindings.lastSeenAt, cutoffs.findings)))
    .limit(batchSize);
  const staleFindingIds = staleFindings.map((finding) => finding.id);

  let findingAlertsDeleted = 0;
  let findingsDeleted = 0;
  if (staleFindingIds.length > 0) {
    const alertsForFindings = await db.delete(siemAlerts)
      .where(inArray(siemAlerts.findingId, staleFindingIds))
      .returning({ id: siemAlerts.id });
    const deletedFindings = await db.delete(siemFindings)
      .where(inArray(siemFindings.id, staleFindingIds))
      .returning({ id: siemFindings.id });
    findingAlertsDeleted = alertsForFindings.length;
    findingsDeleted = deletedFindings.length;
  }

  const deletedEvents = await db.delete(syslogEvents)
    .where(lt(syslogEvents.receivedAt, cutoffs.events))
    .returning({ id: syslogEvents.id });
  const deletedRawEvents = await db.delete(syslogEventsRaw)
    .where(and(
      lt(syslogEventsRaw.receivedAt, cutoffs.raw),
      sql`not exists (select 1 from ${syslogEvents} where ${syslogEvents.rawEventId} = ${syslogEventsRaw.id})`,
    ))
    .returning({ id: syslogEventsRaw.id });

  return {
    rawEventsDeleted: deletedRawEvents.length,
    eventsDeleted: deletedEvents.length,
    findingsDeleted,
    alertsDeleted: oldAlerts.length + findingAlertsDeleted,
  };
}
