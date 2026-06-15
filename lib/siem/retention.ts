import { db } from "../../db";
import { siemAlerts, siemEvidenceEvents, siemEventsQuarantine, siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "../../db/schema";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { archiveFindingEvidence } from "./evidence";
import { partitionsForWindow, isPartitionFullyExpired, partitionName } from "./partitioning";

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
  eventsQuarantined: number;
  quarantineRetentionDeleted: number;
  findingsDeleted: number;
  alertsDeleted: number;
  evidenceArchivedFindings: number;
  partitionsCreated: number;
  partitionsDropped: number;
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

const PARTITIONED_TABLES = ["syslog_events", "syslog_events_raw"] as const;

/** Idempotently create weekly partitions covering recent + upcoming weeks. */
async function ensurePartitions(now: Date): Promise<number> {
  let created = 0;
  const weeks = partitionsForWindow(now, 1, 2); // last week + this week + 2 ahead
  for (const base of PARTITIONED_TABLES) {
    for (const week of weeks) {
      const name = partitionName(base, week.start);
      const startIso = week.start.toISOString();
      const endIso = week.end.toISOString();
      // CREATE TABLE IF NOT EXISTS ... PARTITION OF is idempotent.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(name)}
        PARTITION OF ${sql.identifier(base)}
        FOR VALUES FROM (${startIso}) TO (${endIso})
      `);
      created++;
    }
  }
  return created;
}

/** Drop partitions whose entire range is older than the most-lenient cutoff. */
async function dropExpiredPartitions(base: string, cutoff: Date, now: Date): Promise<number> {
  // List existing partitions of `base` from pg_inherits.
  const rows = await db.execute<{ child: string }>(sql`
    SELECT c.relname AS child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = ${base}
  `);
  const partitions = (rows.rows ?? rows) as Array<{ child: string }>;
  let dropped = 0;
  // Look back up to 520 weeks (~10y) to find candidate week ranges by name.
  const candidates = partitionsForWindow(now, 520, 0);
  const byName = new Map(candidates.map((week) => [partitionName(base, week.start), week]));
  for (const partition of partitions) {
    const week = byName.get(partition.child);
    if (!week) continue; // unknown/legacy partition name → never auto-drop
    if (isPartitionFullyExpired(week, cutoff)) {
      await db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(partition.child)}`);
      dropped++;
    }
  }
  return dropped;
}

export async function runSiemRetentionCleanup(options: { now?: Date; batchSize?: number } = {}): Promise<SiemRetentionCleanupResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(Math.floor(options.batchSize ?? 1000), 10000));

  const [settings] = await db.execute<{
    raw_retention_days: number | null;
    event_retention_days: number | null;
    finding_retention_days: number | null;
    alert_retention_days: number | null;
    quarantine_enabled: boolean | null;
    quarantine_retention_days: number | null;
  }>(sql`
    SELECT raw_retention_days, event_retention_days, finding_retention_days, alert_retention_days,
           quarantine_enabled, quarantine_retention_days
    FROM siem_settings LIMIT 1
  `).then((res) => (res.rows ?? res) as Array<{
    raw_retention_days: number | null;
    event_retention_days: number | null;
    finding_retention_days: number | null;
    alert_retention_days: number | null;
    quarantine_enabled: boolean | null;
    quarantine_retention_days: number | null;
  }>);

  const globalEventDays = normalizeRetentionDays(settings?.event_retention_days, DEFAULT_SIEM_RETENTION_DAYS.events);
  const globalRawDays = normalizeRetentionDays(settings?.raw_retention_days, DEFAULT_SIEM_RETENTION_DAYS.raw);
  const globalFindingDays = normalizeRetentionDays(settings?.finding_retention_days, DEFAULT_SIEM_RETENTION_DAYS.findings);
  const globalAlertDays = normalizeRetentionDays(settings?.alert_retention_days, DEFAULT_SIEM_RETENTION_DAYS.alerts);
  const quarantineEnabled = settings?.quarantine_enabled !== false;
  const quarantineRetentionDays = normalizeRetentionDays(settings?.quarantine_retention_days, 365);

  const eventCutoff = cutoff(now, globalEventDays);
  const rawCutoff = cutoff(now, globalRawDays);
  const findingCutoff = cutoff(now, globalFindingDays);
  const alertCutoff = cutoff(now, globalAlertDays);

  // Load source overrides (only the column needed for the lenient cutoff + per-source delete).
  const sources = await db
    .select({ id: syslogSources.id, eventRetentionDays: syslogSources.eventRetentionDays })
    .from(syslogSources);

  // ----- PHASE A: archive finding evidence before any deletion -----
  // Archive non-Resolved findings that still reference events but are not yet archived.
  // We archive eagerly (any unarchived finding with events) so a later partition drop
  // can never destroy referenced events.
  const unarchived = await db
    .select({ id: siemFindings.id, sampleEventIds: siemFindings.sampleEventIds })
    .from(siemFindings)
    .where(and(eq(siemFindings.evidenceArchived, false), ne(siemFindings.status, "Resolved")))
    .limit(batchSize);

  let evidenceArchivedFindings = 0;
  for (const finding of unarchived) {
    await archiveFindingEvidence(finding);
    evidenceArchivedFindings++;
  }

  // ----- PHASE B: partition maintenance (create upcoming, drop fully-expired) -----
  const partitionsCreated = await ensurePartitions(now);
  const lenientCutoff = mostLenientEventCutoff(sources, globalEventDays, now);
  let partitionsDropped = 0;
  partitionsDropped += await dropExpiredPartitions("syslog_events", lenientCutoff, now);
  // raw partitions follow the raw cutoff but never drop newer than the event lenient cutoff,
  // so referenced raws joined to live events are never lost.
  const lenientRawCutoff = new Date(Math.min(rawCutoff.getTime(), lenientCutoff.getTime()));
  partitionsDropped += await dropExpiredPartitions("syslog_events_raw", lenientRawCutoff, now);

  // ----- PHASE C: precise per-source delete inside still-live partitions -----
  let eventsDeleted = 0;
  for (const source of sources) {
    const sourceDays = resolveSourceCutoffDays(source.eventRetentionDays, globalEventDays);
    // Sources at/above the global default are fully handled by partition drops.
    if (sourceDays >= globalEventDays) continue;
    const sourceCutoff = cutoff(now, sourceDays);
    // Loop batched deletes until drained.
    // Skip events that belong to an unresolved-but-already-archived finding? Not needed:
    // evidence is self-contained, so deleting the hot event is safe post-archive.
    // We still avoid deleting events newer than the source cutoff.
    let done = false;
    while (!done) {
      const victims = await db
        .select({ id: syslogEvents.id })
        .from(syslogEvents)
        .where(and(eq(syslogEvents.sourceId, source.id), lt(syslogEvents.receivedAt, sourceCutoff)))
        .limit(batchSize);
      if (victims.length === 0) {
        done = true;
      } else {
        const ids = victims.map((row) => row.id);
        const deleted = await db.delete(syslogEvents).where(inArray(syslogEvents.id, ids)).returning({ id: syslogEvents.id });
        eventsDeleted += deleted.length;
        if (victims.length < batchSize) done = true;
      }
    }
  }

  // Global event handling for events with NO source mapping (sourceId IS NULL) past global cutoff,
  // covering rows inside still-live partitions. When quarantine is enabled, INSERT into
  // siem_events_quarantine first, then DELETE from syslog_events. Otherwise, just delete.
  let eventsQuarantined = 0;
  let done = false;
  while (!done) {
    const victims = await db
      .select({
        id: syslogEvents.id,
        rawEventId: syslogEvents.rawEventId,
        eventTime: syslogEvents.eventTime,
        receivedAt: syslogEvents.receivedAt,
        sourceIp: syslogEvents.sourceIp,
        hostname: syslogEvents.hostname,
        severity: syslogEvents.severity,
        message: syslogEvents.message,
      })
      .from(syslogEvents)
      .where(and(sql`${syslogEvents.sourceId} is null`, lt(syslogEvents.receivedAt, eventCutoff)))
      .limit(batchSize);
    if (victims.length === 0) {
      done = true;
    } else {
      const ids = victims.map((row) => row.id);
      if (quarantineEnabled) {
        // Atomic: insert quarantine rows + delete source rows. Use a transaction
        // so an interrupted cleanup can never end up with quarantine rows but
        // no corresponding originals lost (or vice versa).
        await db.transaction(async (tx) => {
          await tx.insert(siemEventsQuarantine).values(
            victims.map((row) => ({
              originalEventId: row.id,
              rawEventId: row.rawEventId,
              eventTime: row.eventTime,
              receivedAt: row.receivedAt,
              sourceIp: row.sourceIp,
              hostname: row.hostname,
              severity: row.severity,
              message: row.message,
              quarantinedAt: new Date(),
              quarantinedReason: "sourceId null past retention cutoff",
            })),
          );
          await tx.delete(syslogEvents).where(inArray(syslogEvents.id, ids));
        });
        eventsQuarantined += victims.length;
      } else {
        const deleted = await db.delete(syslogEvents).where(inArray(syslogEvents.id, ids)).returning({ id: syslogEvents.id });
        eventsDeleted += deleted.length;
      }
      if (victims.length < batchSize) done = true;
    }
  }

  // Quarantine retention: drop rows past quarantine retention.
  const quarantineCutoff = cutoff(now, quarantineRetentionDays);
  let quarantineRetentionDeleted = 0;
  let qDone = false;
  while (!qDone) {
    const victims = await db
      .select({ id: siemEventsQuarantine.id })
      .from(siemEventsQuarantine)
      .where(lt(siemEventsQuarantine.quarantinedAt, quarantineCutoff))
      .limit(batchSize);
    if (victims.length === 0) {
      qDone = true;
    } else {
      const ids = victims.map((row) => row.id);
      const deleted = await db.delete(siemEventsQuarantine).where(inArray(siemEventsQuarantine.id, ids)).returning({ id: siemEventsQuarantine.id });
      quarantineRetentionDeleted += deleted.length;
      if (victims.length < batchSize) qDone = true;
    }
  }

  // Orphan raw events (no surviving event) older than the raw cutoff, inside live partitions.
  const deletedRawEvents = await db.delete(syslogEventsRaw)
    .where(and(
      lt(syslogEventsRaw.receivedAt, rawCutoff),
      sql`not exists (select 1 from ${syslogEvents} where ${syslogEvents.rawEventId} = ${syslogEventsRaw.id})`,
    ))
    .returning({ id: syslogEventsRaw.id });

  // ----- Findings & alerts own expiry (never driven by the log stream) -----
  const oldAlerts = await db.delete(siemAlerts)
    .where(lt(siemAlerts.createdAt, alertCutoff))
    .returning({ id: siemAlerts.id });

  const staleFindings = await db
    .select({ id: siemFindings.id })
    .from(siemFindings)
    .where(and(eq(siemFindings.status, "Resolved"), lt(siemFindings.lastSeenAt, findingCutoff)))
    .limit(batchSize);
  const staleFindingIds = staleFindings.map((finding) => finding.id);

  let findingAlertsDeleted = 0;
  let findingsDeleted = 0;
  if (staleFindingIds.length > 0) {
    // Evidence rows FK to findings with no cascade; delete them first.
    await db.delete(siemEvidenceEvents).where(inArray(siemEvidenceEvents.findingId, staleFindingIds));
    const alertsForFindings = await db.delete(siemAlerts)
      .where(inArray(siemAlerts.findingId, staleFindingIds))
      .returning({ id: siemAlerts.id });
    const deletedFindings = await db.delete(siemFindings)
      .where(inArray(siemFindings.id, staleFindingIds))
      .returning({ id: siemFindings.id });
    findingAlertsDeleted = alertsForFindings.length;
    findingsDeleted = deletedFindings.length;
  }

  return {
    rawEventsDeleted: deletedRawEvents.length,
    eventsDeleted,
    eventsQuarantined,
    quarantineRetentionDeleted,
    findingsDeleted,
    alertsDeleted: oldAlerts.length + findingAlertsDeleted,
    evidenceArchivedFindings,
    partitionsCreated,
    partitionsDropped,
  };
}
