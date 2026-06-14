import { db } from "../../db";
import { siemEvidenceEvents, siemFindings, syslogEvents, syslogEventsRaw } from "../../db/schema";
import { and, eq, inArray } from "drizzle-orm";

/** Shape of a syslog_events row left-joined with its raw message. */
export type JoinedEventRow = {
  id: number;
  eventTime: Date | null;
  receivedAt: Date;
  sourceIp: string;
  hostname: string | null;
  deviceId: number | null;
  sourceId: number | null;
  message: string;
  rawMessage: string | null;
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  srcIp: string | null;
  dstIp: string | null;
  username: string | null;
  severity: number | null;
  metadata: Record<string, unknown> | null;
};

export type EvidenceInsert = typeof siemEvidenceEvents.$inferInsert;

/** Pure: map a joined event row into a self-contained evidence insert row. */
export function buildEvidenceSnapshot(findingId: number, row: JoinedEventRow): EvidenceInsert {
  return {
    findingId,
    originalEventId: row.id,
    eventTime: row.eventTime,
    receivedAt: row.receivedAt,
    sourceIp: row.sourceIp,
    hostname: row.hostname,
    deviceId: row.deviceId,
    sourceId: row.sourceId,
    message: row.message,
    rawMessage: row.rawMessage,
    category: row.category,
    normalizedType: row.normalizedType,
    action: row.action,
    outcome: row.outcome,
    srcIp: row.srcIp,
    dstIp: row.dstIp,
    username: row.username,
    severity: row.severity,
    metadata: row.metadata ?? {},
  };
}

/**
 * Archive the referenced events of a finding into siem_evidence_events and mark
 * the finding evidenceArchived=true. Idempotent: skips events already archived
 * for this finding. Returns the number of evidence rows inserted.
 */
export async function archiveFindingEvidence(finding: { id: number; sampleEventIds: number[] }): Promise<number> {
  if (finding.sampleEventIds.length === 0) {
    await db.update(siemFindings).set({ evidenceArchived: true, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
    return 0;
  }

  const rows = await db
    .select({
      id: syslogEvents.id,
      eventTime: syslogEvents.eventTime,
      receivedAt: syslogEvents.receivedAt,
      sourceIp: syslogEvents.sourceIp,
      hostname: syslogEvents.hostname,
      deviceId: syslogEvents.deviceId,
      sourceId: syslogEvents.sourceId,
      message: syslogEvents.message,
      rawMessage: syslogEventsRaw.rawMessage,
      category: syslogEvents.category,
      normalizedType: syslogEvents.normalizedType,
      action: syslogEvents.action,
      outcome: syslogEvents.outcome,
      srcIp: syslogEvents.srcIp,
      dstIp: syslogEvents.dstIp,
      username: syslogEvents.username,
      severity: syslogEvents.severity,
      metadata: syslogEvents.metadata,
    })
    .from(syslogEvents)
    .leftJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
    .where(inArray(syslogEvents.id, finding.sampleEventIds));

  let inserted = 0;
  if (rows.length > 0) {
    const snapshots = rows.map((row) => buildEvidenceSnapshot(finding.id, row as JoinedEventRow));
    const insertedRows = await db
      .insert(siemEvidenceEvents)
      .values(snapshots)
      .onConflictDoNothing({ target: [siemEvidenceEvents.findingId, siemEvidenceEvents.originalEventId] })
      .returning({ id: siemEvidenceEvents.id });
    inserted = insertedRows.length;
  }

  await db.update(siemFindings).set({ evidenceArchived: true, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
  return inserted;
}

export type FindingEvidenceSample = {
  id: number;
  receivedAt: Date;
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  username: string | null;
  srcIp: string | null;
  dstIp: string | null;
  message: string;
  rawMessage: string | null;
};

/**
 * Read a finding's evidence events. If archived, read from siem_evidence_events;
 * otherwise read the still-hot syslog_events joined with raw. Returns at most
 * `limit` rows. `siteId` restricts the hot path to the active site (evidence
 * rows are already finding-scoped).
 */
export async function getFindingEvidence(
  finding: { id: number; evidenceArchived: boolean; sampleEventIds: number[] },
  options: { limit: number; siteId: number },
): Promise<FindingEvidenceSample[]> {
  const ids = finding.sampleEventIds.slice(0, options.limit);

  if (finding.evidenceArchived) {
    const rows = await db
      .select({
        id: siemEvidenceEvents.originalEventId,
        receivedAt: siemEvidenceEvents.receivedAt,
        category: siemEvidenceEvents.category,
        normalizedType: siemEvidenceEvents.normalizedType,
        action: siemEvidenceEvents.action,
        outcome: siemEvidenceEvents.outcome,
        username: siemEvidenceEvents.username,
        srcIp: siemEvidenceEvents.srcIp,
        dstIp: siemEvidenceEvents.dstIp,
        message: siemEvidenceEvents.message,
        rawMessage: siemEvidenceEvents.rawMessage,
      })
      .from(siemEvidenceEvents)
      .where(eq(siemEvidenceEvents.findingId, finding.id))
      .limit(options.limit);
    return rows;
  }

  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: syslogEvents.id,
      receivedAt: syslogEvents.receivedAt,
      category: syslogEvents.category,
      normalizedType: syslogEvents.normalizedType,
      action: syslogEvents.action,
      outcome: syslogEvents.outcome,
      username: syslogEvents.username,
      srcIp: syslogEvents.srcIp,
      dstIp: syslogEvents.dstIp,
      message: syslogEvents.message,
      rawMessage: syslogEventsRaw.rawMessage,
    })
    .from(syslogEvents)
    .leftJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
    .where(and(eq(syslogEvents.siteId, options.siteId), inArray(syslogEvents.id, ids)));
  return rows;
}
