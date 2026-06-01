#!/usr/bin/env tsx
import dotenv from "dotenv";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, devices, locations, siemSettings, sites, syslogEvents, syslogEventsRaw, syslogSources } from "../db/schema";
import { processRawSyslogEvent } from "../lib/siem/process-raw-event";
import { buildAssetMetadata, matchSyslogSource, type DeviceCandidate, type SourceCandidate } from "../lib/siem/source-enrichment";
import type { SiemVendor } from "../lib/siem/types";

dotenv.config();

const batchSize = Number(process.env.SIEM_PARSER_BATCH_SIZE ?? 100);
const pollIntervalMs = Number(process.env.SIEM_PARSER_POLL_INTERVAL_MS ?? 5000);

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

async function runOnce() {
  const rows = await db.select().from(syslogEventsRaw)
    .where(eq(syslogEventsRaw.ingestStatus, "received"))
    .orderBy(asc(syslogEventsRaw.receivedAt))
    .limit(batchSize);
  const context = await loadContext();

  for (const raw of rows) {
    const initial = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: "generic" });
    const match = matchSyslogSource({ sourceIp: raw.sourceIp, hostname: initial.hostname, sources: context.sources, devices: context.devices });
    const siteId = match.siteId ?? context.settings?.defaultSiemSiteId ?? null;
    const device = context.devices.find((candidate) => candidate.id === match.deviceId) ?? null;
    const site = context.sites.find((candidate) => candidate.id === siteId) ?? null;
    let sourceId = match.sourceId;

    if (match.matchType === "unknown" && context.settings?.unknownSourceEnabled && siteId) {
      const [createdSource] = await db.insert(syslogSources).values({
        siteId,
        sourceIp: raw.sourceIp,
        hostname: initial.hostname,
        displayName: initial.hostname ?? raw.sourceIp,
        vendor: "generic",
        parserProfile: "generic",
        lastSeenAt: raw.receivedAt,
        eventCount: 0,
      }).returning();
      if (createdSource) {
        sourceId = createdSource.id;
        context.sources.push({
          id: createdSource.id,
          siteId: createdSource.siteId,
          deviceId: createdSource.deviceId,
          sourceIp: createdSource.sourceIp,
          hostname: createdSource.hostname,
          vendor: createdSource.vendor,
          parserProfile: createdSource.parserProfile,
        });
      }
    }

    const processed = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: match.vendor as SiemVendor });
    const metadata = { ...processed.metadata, enrichment: buildAssetMetadata({ site, device }), matchType: match.matchType };

    if (processed.ingestStatus === "parsed") {
      await db.insert(syslogEvents).values({
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
    }

    if (sourceId) {
      await db.update(syslogSources).set({ lastSeenAt: raw.receivedAt, eventCount: sql`${syslogSources.eventCount} + 1`, updatedAt: new Date() }).where(eq(syslogSources.id, sourceId));
    }

    await db.update(syslogEventsRaw).set({ ingestStatus: processed.ingestStatus, parseError: processed.parseError }).where(and(eq(syslogEventsRaw.id, raw.id), eq(syslogEventsRaw.ingestStatus, "received")));
  }

  return rows.length;
}

async function loop() {
  while (true) {
    const count = await runOnce();
    if (count > 0) console.log(`Parsed ${count} raw syslog events`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM parser worker failed", error);
  process.exit(1);
});
