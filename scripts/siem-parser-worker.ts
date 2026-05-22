#!/usr/bin/env tsx
import dotenv from "dotenv";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { syslogEvents, syslogEventsRaw } from "../db/schema";
import { processRawSyslogEvent } from "../lib/siem/process-raw-event";

dotenv.config();

const batchSize = Number(process.env.SIEM_PARSER_BATCH_SIZE ?? 100);
const pollIntervalMs = Number(process.env.SIEM_PARSER_POLL_INTERVAL_MS ?? 5000);

async function runOnce() {
  const rows = await db.select().from(syslogEventsRaw)
    .where(eq(syslogEventsRaw.ingestStatus, "received"))
    .orderBy(asc(syslogEventsRaw.receivedAt))
    .limit(batchSize);

  for (const raw of rows) {
    const processed = processRawSyslogEvent({ rawMessage: raw.rawMessage, vendor: "generic" });
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
        vendor: "generic",
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
        metadata: processed.metadata,
      });
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
