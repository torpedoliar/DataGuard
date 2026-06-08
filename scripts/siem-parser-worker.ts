#!/usr/bin/env tsx
import dotenv from "dotenv";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, devices, locations, siemSettings, sites, syslogEvents, syslogEventsRaw, syslogSources } from "../db/schema";
import { processRawSyslogEvent } from "../lib/siem/process-raw-event";
import { buildAssetMetadata, matchSyslogSource, type DeviceCandidate, type SourceCandidate } from "../lib/siem/source-enrichment";
import type { SiemVendor } from "../lib/siem/types";

dotenv.config();

const batchSize = Number(process.env.SIEM_PARSER_BATCH_SIZE ?? 1000);
const pollIntervalMs = Number(process.env.SIEM_PARSER_POLL_INTERVAL_MS ?? 2000);
const contextTtlMs = Number(process.env.SIEM_PARSER_CONTEXT_TTL_MS ?? 30000);
// Postgres caps a statement at 65535 bind params. syslog_events has ~30 columns,
// so 500 rows/insert (~15k params) stays well under the limit.
const insertChunkSize = Number(process.env.SIEM_PARSER_INSERT_CHUNK_SIZE ?? 500);

type ParserContext = Awaited<ReturnType<typeof loadContext>>;

let cachedContext: ParserContext | null = null;
let contextLoadedAt = 0;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadContext() {
  const [sourceRows, deviceRows, siteRows, settingsRows] = await Promise.all([
    db.select().from(syslogSources),
    db.select({
      id: devices.id,
      siteId: devices.siteId,
      name: devices.name,
      ipAddress: devices.ipAddress,
      assetCode: devices.assetCode,
      categoryName: categories.name,
      brandName: brands.name,
      locationName: locations.name,
      rackName: devices.rackName,
      rackPosition: devices.rackPosition,
      zone: devices.zone,
    }).from(devices).leftJoin(categories, eq(devices.categoryId, categories.id)).leftJoin(brands, eq(devices.brandId, brands.id)).leftJoin(locations, eq(devices.locationId, locations.id)),
    db.select().from(sites),
    db.select().from(siemSettings).limit(1),
  ]);

  return {
    sources: sourceRows as SourceCandidate[],
    devices: deviceRows as DeviceCandidate[],
    sites: siteRows,
    settings: settingsRows[0] ?? null,
  };
}

async function getContext() {
  const now = Date.now();
  if (!cachedContext || now - contextLoadedAt > contextTtlMs) {
    cachedContext = await loadContext();
    contextLoadedAt = now;
  }
  return cachedContext;
}

type RawRow = typeof syslogEventsRaw.$inferSelect;
type EventInsert = typeof syslogEvents.$inferInsert;

// Auto-create syslog sources for unknown IPs before the main pass so later rows
// in the same batch (same IP) match the freshly created source. Dedupes by IP.
async function ensureUnknownSources(rows: RawRow[], context: ParserContext) {
  if (!context.settings?.unknownSourceEnabled) return;

  const known = new Set(context.sources.map((source) => source.sourceIp));
  const pending = new Map<string, { hostname: string | null; siteId: number; receivedAt: Date }>();

  for (const raw of rows) {
    if (known.has(raw.sourceIp) || pending.has(raw.sourceIp)) continue;
    const initial = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: "generic" });
    const match = matchSyslogSource({ sourceIp: raw.sourceIp, hostname: initial.hostname, sources: context.sources, devices: context.devices });
    if (match.matchType !== "unknown") continue;
    const siteId = match.siteId ?? context.settings?.defaultSiemSiteId ?? null;
    if (!siteId) continue;
    pending.set(raw.sourceIp, { hostname: initial.hostname, siteId, receivedAt: raw.receivedAt });
  }

  for (const [sourceIp, info] of pending) {
    const [created] = await db.insert(syslogSources).values({
      siteId: info.siteId,
      sourceIp,
      hostname: info.hostname,
      displayName: info.hostname ?? sourceIp,
      vendor: "generic",
      parserProfile: "generic",
      lastSeenAt: info.receivedAt,
      eventCount: 0,
    }).returning();
    if (created) {
      context.sources.push({
        id: created.id,
        siteId: created.siteId,
        deviceId: created.deviceId,
        sourceIp: created.sourceIp,
        hostname: created.hostname,
        vendor: created.vendor,
        parserProfile: created.parserProfile,
      });
    }
  }
}

async function runOnce() {
  const rows = await db.select().from(syslogEventsRaw)
    .where(eq(syslogEventsRaw.ingestStatus, "received"))
    .orderBy(asc(syslogEventsRaw.receivedAt))
    .limit(batchSize);
  if (rows.length === 0) return 0;

  const context = await getContext();
  await ensureUnknownSources(rows, context);

  const eventValues: EventInsert[] = [];
  const parsedIds: number[] = [];
  const failedIds: number[] = [];
  const sourceAgg = new Map<number, { count: number; lastSeenAt: Date }>();

  for (const raw of rows) {
    const initial = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: "generic" });
    const match = matchSyslogSource({ sourceIp: raw.sourceIp, hostname: initial.hostname, sources: context.sources, devices: context.devices });
    const siteId = match.siteId ?? context.settings?.defaultSiemSiteId ?? null;
    const device = context.devices.find((candidate) => candidate.id === match.deviceId) ?? null;
    const site = context.sites.find((candidate) => candidate.id === siteId) ?? null;
    const sourceId = match.sourceId;

    const processed = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: match.vendor as SiemVendor });
    const metadata = { ...processed.metadata, enrichment: buildAssetMetadata({ site, device }), matchType: match.matchType };

    if (processed.ingestStatus === "parsed") {
      eventValues.push({
        rawEventId: raw.id,
        eventTime: processed.eventTime,
        receivedAt: raw.receivedAt,
        sourceIp: raw.sourceIp,
        hostname: processed.hostname,
        facility: processed.facility,
        severity: processed.severity,
        priority: processed.priority,
        appName: processed.appName,
        program: processed.program,
        processId: processed.processId,
        message: processed.message,
        siteId,
        deviceId: match.deviceId,
        sourceId,
        vendor: match.vendor as SiemVendor,
        parser: processed.parser,
        category: processed.category,
        normalizedType: processed.normalizedType,
        action: processed.action,
        outcome: processed.outcome,
        srcIp: processed.srcIp,
        srcPort: processed.srcPort,
        dstIp: processed.dstIp,
        dstPort: processed.dstPort,
        username: processed.username,
        interfaceName: processed.interfaceName,
        protocol: processed.protocol,
        tags: processed.tags,
        metadata,
      });
      parsedIds.push(raw.id);
    } else {
      failedIds.push(raw.id);
    }

    if (sourceId) {
      const existing = sourceAgg.get(sourceId);
      if (existing) {
        existing.count += 1;
        if (raw.receivedAt > existing.lastSeenAt) existing.lastSeenAt = raw.receivedAt;
      } else {
        sourceAgg.set(sourceId, { count: 1, lastSeenAt: raw.receivedAt });
      }
    }
  }

  // Atomic: insert parsed events and flip raw status together. If this transaction
  // rolls back (crash/restart mid-batch), rows stay "received" and are reprocessed
  // without producing duplicate syslog_events.
  await db.transaction(async (tx) => {
    for (const part of chunk(eventValues, insertChunkSize)) {
      await tx.insert(syslogEvents).values(part);
    }
    for (const ids of chunk(parsedIds, 1000)) {
      await tx.update(syslogEventsRaw).set({ ingestStatus: "parsed", parseError: null })
        .where(and(inArray(syslogEventsRaw.id, ids), eq(syslogEventsRaw.ingestStatus, "received")));
    }
    for (const ids of chunk(failedIds, 1000)) {
      await tx.update(syslogEventsRaw).set({ ingestStatus: "parse_failed", parseError: "Unsupported syslog format" })
        .where(and(inArray(syslogEventsRaw.id, ids), eq(syslogEventsRaw.ingestStatus, "received")));
    }
    for (const [sourceId, agg] of sourceAgg) {
      await tx.update(syslogSources).set({ lastSeenAt: agg.lastSeenAt, eventCount: sql`${syslogSources.eventCount} + ${agg.count}`, updatedAt: new Date() })
        .where(eq(syslogSources.id, sourceId));
    }
  });

  return rows.length;
}

async function loop() {
  while (true) {
    const count = await runOnce();
    if (count > 0) console.log(`Parsed ${count} raw syslog events`);
    // Full batch means backlog remains — keep draining without sleeping.
    if (count < batchSize) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM parser worker failed", error);
  process.exit(1);
});
