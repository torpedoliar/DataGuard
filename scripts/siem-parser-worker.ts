#!/usr/bin/env tsx
import dotenv from "dotenv";
import fs from "node:fs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, devices, locations, sites, syslogEvents, syslogEventsRaw, syslogSources } from "../db/schema";
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
const errorSleepMs = Number(process.env.SIEM_PARSER_ERROR_SLEEP_MS ?? 5000);
const healthIntervalMs = Number(process.env.SIEM_PARSER_HEALTH_INTERVAL_MS ?? 60_000);
const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-siem-parser.health.json";

type HealthStatus = {
  updatedAt: string;
  lastParsedAt?: string;
  lastError?: string;
  parsedTotal: number;
};

let parsedTotal = 0;
let lastError: string | undefined;

function writeHealth(status: HealthStatus) {
  try {
    fs.writeFileSync(healthFile, JSON.stringify(status), "utf8");
  } catch (error) {
    console.error("Failed to write parser health file", error);
  }
}

function publishHealth() {
  writeHealth({
    updatedAt: new Date().toISOString(),
    lastParsedAt: parsedTotal > 0 ? new Date().toISOString() : undefined,
    lastError,
    parsedTotal,
  });
  lastError = undefined;
}

type ParserContext = Awaited<ReturnType<typeof loadContext>>;

let cachedContext: ParserContext | null = null;
let contextLoadedAt = 0;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadContext() {
  const [sourceRows, deviceRows, siteRows] = await Promise.all([
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
  ]);

  return {
    sources: sourceRows as SourceCandidate[],
    devices: deviceRows as DeviceCandidate[],
    sites: siteRows,
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

async function runOnce() {
  const rows = await db.select().from(syslogEventsRaw)
    .where(eq(syslogEventsRaw.ingestStatus, "received"))
    .orderBy(asc(syslogEventsRaw.receivedAt))
    .limit(batchSize);
  if (rows.length === 0) return 0;

  const context = await getContext();

  const eventValues: EventInsert[] = [];
  // Raw ids grouped by site so each status flip can set one siteId per update.
  const parsedBySite = new Map<number | null, number[]>();
  const failedBySite = new Map<number | null, number[]>();
  const droppedIds: number[] = [];
  const sourceAgg = new Map<number, { count: number; lastSeenAt: Date }>();

  const pushSite = (map: Map<number | null, number[]>, siteId: number | null, id: number) => {
    const arr = map.get(siteId);
    if (arr) arr.push(id);
    else map.set(siteId, [id]);
  };

  for (const raw of rows) {
    const initial = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: "generic" });
    const match = matchSyslogSource({ sourceIp: raw.sourceIp, hostname: initial.hostname, sources: context.sources, devices: context.devices });
    // Strict per-site: a matched source/device carries its own siteId (NOT NULL).
    // Unknown sources (no match) have no site → drop, never guess.
    const siteId = match.siteId;
    const sourceId = match.sourceId;

    // Unknown source: drop the raw event. No auto-create — sources must be
    // mapped explicitly per-site by an admin.
    if (match.matchType === "unknown" || !siteId) {
      droppedIds.push(raw.id);
      continue;
    }

    const device = context.devices.find((candidate) => candidate.id === match.deviceId) ?? null;
    const site = context.sites.find((candidate) => candidate.id === siteId) ?? null;

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
      pushSite(parsedBySite, siteId, raw.id);
    } else {
      pushSite(failedBySite, siteId, raw.id);
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
  // without producing duplicate syslog_events. Stamp raw siteId on every path so
  // raw events carry the same tenancy as their parsed event (or null for dropped
  // unknown sources).
  await db.transaction(async (tx) => {
    for (const part of chunk(eventValues, insertChunkSize)) {
      await tx.insert(syslogEvents).values(part);
    }
    for (const [siteId, ids] of parsedBySite) {
      for (const part of chunk(ids, 1000)) {
        await tx.update(syslogEventsRaw).set({ ingestStatus: "parsed", siteId, parseError: null })
          .where(and(inArray(syslogEventsRaw.id, part), eq(syslogEventsRaw.ingestStatus, "received")));
      }
    }
    for (const [siteId, ids] of failedBySite) {
      for (const part of chunk(ids, 1000)) {
        await tx.update(syslogEventsRaw).set({ ingestStatus: "parse_failed", siteId, parseError: "Unsupported syslog format" })
          .where(and(inArray(syslogEventsRaw.id, part), eq(syslogEventsRaw.ingestStatus, "received")));
      }
    }
    for (const part of chunk(droppedIds, 1000)) {
      await tx.update(syslogEventsRaw).set({ ingestStatus: "dropped", siteId: null, parseError: "No matching syslog source for this site" })
        .where(and(inArray(syslogEventsRaw.id, part), eq(syslogEventsRaw.ingestStatus, "received")));
    }
    for (const [sourceId, agg] of sourceAgg) {
      await tx.update(syslogSources).set({ lastSeenAt: agg.lastSeenAt, eventCount: sql`${syslogSources.eventCount} + ${agg.count}`, updatedAt: new Date() })
        .where(eq(syslogSources.id, sourceId));
    }
  });

  return rows.length;
}

let stopping = false;

async function loop() {
  publishHealth();
  let lastHealthAt = Date.now();

  while (!stopping) {
    try {
      const count = await runOnce();
      if (count > 0) {
        parsedTotal += count;
        console.log(`Parsed ${count} raw syslog events`);
      }
      // Full batch means backlog remains — keep draining without sleeping.
      if (count < batchSize) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("SIEM parser tick failed, retrying", error);
      await new Promise((resolve) => setTimeout(resolve, errorSleepMs));
    }

    const now = Date.now();
    if (now - lastHealthAt > healthIntervalMs) {
      publishHealth();
      console.log("siem parser heartbeat", { parsedTotal });
      lastHealthAt = now;
    }
  }
}

void loop().catch((error) => {
  console.error("SIEM parser worker fatal error", error);
  process.exit(1);
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  publishHealth();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void shutdown(); });
}
