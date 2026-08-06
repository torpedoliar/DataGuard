import { db } from "../../db";
import { siemAlerts, siemEvidenceEvents, siemEventsQuarantine, siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "../../db/schema";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { archiveFindingEvidenceInTx } from "./evidence";
import { partitionsForWindow, isPartitionFullyExpired, partitionName } from "./partitioning";
import { captureSiemSnapshot } from "./snapshots";

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
        FOR VALUES FROM (${sql.raw(`'${startIso}'`)}) TO (${sql.raw(`'${endIso}'`)})
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

  // Per-site settings: every site owns its own siem_settings row. Load all of
  // them and loop per-site cutoffs below. (pre-multi-site this was a global
  // `LIMIT 1` singleton.)
  const settingsRows = await db.execute<{
    site_id: number | null;
    raw_retention_days: number | null;
    event_retention_days: number | null;
    finding_retention_days: number | null;
    alert_retention_days: number | null;
    quarantine_enabled: boolean | null;
    quarantine_retention_days: number | null;
  }>(sql`
    SELECT site_id, raw_retention_days, event_retention_days, finding_retention_days, alert_retention_days,
           quarantine_enabled, quarantine_retention_days
    FROM siem_settings
  `).then((res) => (res.rows ?? res) as Array<{
    site_id: number | null;
    raw_retention_days: number | null;
    event_retention_days: number | null;
    finding_retention_days: number | null;
    alert_retention_days: number | null;
    quarantine_enabled: boolean | null;
    quarantine_retention_days: number | null;
  }>);

  // Sources carry siteId for per-site scoping + the global partition cutoff.
  const sources = await db
    .select({ id: syslogSources.id, siteId: syslogSources.siteId, eventRetentionDays: syslogSources.eventRetentionDays })
    .from(syslogSources);

  // Partitions are global by time, so the drop cutoff is the MOST LENIENT event
  // retention across ALL sites' settings + every source override. Any data older
  // than this is expired for every site, so the partition is safe to drop.
  const globalMaxEventDays = settingsRows.reduce(
    (max, s) => Math.max(max, normalizeRetentionDays(s.event_retention_days, DEFAULT_SIEM_RETENTION_DAYS.events)),
    DEFAULT_SIEM_RETENTION_DAYS.events,
  );
  const globalMaxRawDays = settingsRows.reduce(
    (max, s) => Math.max(max, normalizeRetentionDays(s.raw_retention_days, DEFAULT_SIEM_RETENTION_DAYS.raw)),
    DEFAULT_SIEM_RETENTION_DAYS.raw,
  );
  const lenientCutoff = mostLenientEventCutoff(sources, globalMaxEventDays, now);
  const lenientRawCutoff = new Date(Math.min(cutoff(now, globalMaxRawDays).getTime(), lenientCutoff.getTime()));

  // ----- PHASE A: archive finding evidence before any deletion -----
  // Archive non-Resolved findings that still reference events but are not yet archived.
  // We archive eagerly (any unarchived finding with events) so a later partition drop
  // can never destroy referenced events.
  //
  // Two retention workers running concurrently must NOT both archive the same
  // finding. PR-1.4 added a unique index on (findingId, originalEventId) that
  // makes double-inserts safe at the row level, but the final
  // `evidenceArchived = true` update would still race (and the second worker
  // would redo every row's insert). Holding FOR UPDATE SKIP LOCKED inside a
  // single transaction means the second worker simply skips the row.
  let evidenceArchivedFindings = 0;
  await db.transaction(async (tx) => {
    const unarchived = await tx
      .select({ id: siemFindings.id, sampleEventIds: siemFindings.sampleEventIds })
      .from(siemFindings)
      .where(and(eq(siemFindings.evidenceArchived, false), ne(siemFindings.status, "Resolved")))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    for (const finding of unarchived) {
      await archiveFindingEvidenceInTx(tx, finding);
      evidenceArchivedFindings++;
    }
  });

  // ----- PHASE B: partition maintenance (create upcoming, drop fully-expired) -----
  // Partitions are global by time, not per-site. Drop cutoff is the most-lenient
  // event retention across ALL sites/sources (computed above), so a partition is
  // only dropped once it's expired for every site.
  const partitionsCreated = await ensurePartitions(now);
  let partitionsDropped = 0;
  partitionsDropped += await dropExpiredPartitions("syslog_events", lenientCutoff, now);
  partitionsDropped += await dropExpiredPartitions("syslog_events_raw", lenientRawCutoff, now);

  // ----- PHASE C/D: per-site cutoffs + precise deletes inside still-live partitions -----
  // Each site has its own retention days, so cutoffs differ per site. Loop the
  // settings rows; scope every delete by eq(siteId). Sites with no settings row
  // get DEFAULT_SIEM_RETENTION_DAYS via the fallback path below.
  let eventsDeleted = 0;
  let eventsQuarantined = 0;
  let quarantineRetentionDeleted = 0;
  let rawEventsDeleted = 0;
  let findingsDeleted = 0;
  let alertsDeleted = 0;

  for (const settings of settingsRows) {
    const siteId = settings.site_id;
    // ponytail: skip rows missing siteId (pre-migration orphans). After 1b the
    // column is NOT NULL so this branch is dead; keep it so 1a cleanup is safe.
    if (!siteId) continue;

    const siteEventDays = normalizeRetentionDays(settings.event_retention_days, DEFAULT_SIEM_RETENTION_DAYS.events);
    const siteRawDays = normalizeRetentionDays(settings.raw_retention_days, DEFAULT_SIEM_RETENTION_DAYS.raw);
    const siteFindingDays = normalizeRetentionDays(settings.finding_retention_days, DEFAULT_SIEM_RETENTION_DAYS.findings);
    const siteAlertDays = normalizeRetentionDays(settings.alert_retention_days, DEFAULT_SIEM_RETENTION_DAYS.alerts);
    const quarantineEnabled = settings.quarantine_enabled !== false;
    const quarantineRetentionDays = normalizeRetentionDays(settings.quarantine_retention_days, 365);

    const eventCutoff = cutoff(now, siteEventDays);
    const rawCutoff = cutoff(now, siteRawDays);
    const findingCutoff = cutoff(now, siteFindingDays);
    const alertCutoff = cutoff(now, siteAlertDays);

    // Per-source deletes: only this site's sources, only overrides shorter than
    // the site default (longer ones are handled by partition drops).
    for (const source of sources) {
      if (source.siteId !== siteId) continue;
      const sourceDays = resolveSourceCutoffDays(source.eventRetentionDays, siteEventDays);
      if (sourceDays >= siteEventDays) continue;
      const sourceCutoff = cutoff(now, sourceDays);
      let done = false;
      while (!done) {
        const victims = await db
          .select({ id: syslogEvents.id })
          .from(syslogEvents)
          .where(and(eq(syslogEvents.sourceId, source.id), eq(syslogEvents.siteId, siteId), lt(syslogEvents.receivedAt, sourceCutoff)))
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

    // Orphan events (sourceId IS NULL) past this site's cutoff → quarantine + delete.
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
        .where(and(eq(syslogEvents.siteId, siteId), sql`${syslogEvents.sourceId} is null`, lt(syslogEvents.receivedAt, eventCutoff)))
        .limit(batchSize);
      if (victims.length === 0) {
        done = true;
      } else {
        const ids = victims.map((row) => row.id);
        if (quarantineEnabled) {
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
                siteId,
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

    // Quarantine retention: drop this site's rows past its quarantine window.
    const quarantineCutoff = cutoff(now, quarantineRetentionDays);
    let qDone = false;
    while (!qDone) {
      const victims = await db
        .select({ id: siemEventsQuarantine.id })
        .from(siemEventsQuarantine)
        .where(and(eq(siemEventsQuarantine.siteId, siteId), lt(siemEventsQuarantine.quarantinedAt, quarantineCutoff)))
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

    // Orphan raw events for this site (no surviving event) older than the site raw cutoff.
    const deletedRawEvents = await db.delete(syslogEventsRaw)
      .where(and(
        eq(syslogEventsRaw.siteId, siteId),
        lt(syslogEventsRaw.receivedAt, rawCutoff),
        sql`not exists (select 1 from ${syslogEvents} where ${syslogEvents.rawEventId} = ${syslogEventsRaw.id})`,
      ))
      .returning({ id: syslogEventsRaw.id });
    rawEventsDeleted += deletedRawEvents.length;

    // Findings & alerts own expiry (never driven by the log stream), scoped by site.
    // siem_alerts has no siteId column; scope via the finding's site through a subquery.
    const oldAlerts = await db.delete(siemAlerts)
      .where(sql`siem_alerts.finding_id IN (SELECT id FROM siem_findings WHERE site_id = ${siteId}) AND created_at < ${alertCutoff}`)
      .returning({ id: siemAlerts.id });
    alertsDeleted += oldAlerts.length;

    const staleFindings = await db
      .select({ id: siemFindings.id })
      .from(siemFindings)
      .where(and(eq(siemFindings.siteId, siteId), eq(siemFindings.status, "Resolved"), lt(siemFindings.lastSeenAt, findingCutoff)))
      .limit(batchSize);
    const staleFindingIds = staleFindings.map((finding) => finding.id);
    if (staleFindingIds.length > 0) {
      await db.delete(siemEvidenceEvents).where(inArray(siemEvidenceEvents.findingId, staleFindingIds));
      const alertsForFindings = await db.delete(siemAlerts)
        .where(inArray(siemAlerts.findingId, staleFindingIds))
        .returning({ id: siemAlerts.id });
      const deletedFindings = await db.delete(siemFindings)
        .where(inArray(siemFindings.id, staleFindingIds))
        .returning({ id: siemFindings.id });
      alertsDeleted += alertsForFindings.length;
      findingsDeleted += deletedFindings.length;
    }
  }

  // Capture a dashboard snapshot. This is best-effort and runs after the
  // cleanup phases, so a snapshot failure can never poison the retention
  // work that already succeeded. The error is logged but not thrown.
  try {
    await captureSiemSnapshot();
  } catch (error) {
    console.error("SIEM retention: dashboard snapshot capture failed", error);
  }

  return {
    rawEventsDeleted,
    eventsDeleted,
    eventsQuarantined,
    quarantineRetentionDeleted,
    findingsDeleted,
    alertsDeleted,
    evidenceArchivedFindings,
    partitionsCreated,
    partitionsDropped,
  };
}
