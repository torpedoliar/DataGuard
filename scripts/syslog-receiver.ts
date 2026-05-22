#!/usr/bin/env tsx
import dotenv from "dotenv";
import { db } from "../db";
import { syslogEventsRaw } from "../db/schema";
import { buildReceiverConfig, createSyslogReceiver, type RawSyslogWriter } from "../lib/siem/receiver";

dotenv.config();

const config = buildReceiverConfig(process.env);

const writer: RawSyslogWriter = {
  async insertRawEvents(events) {
    if (events.length === 0) return;
    await db.insert(syslogEventsRaw).values(events.map((event) => ({
      receivedAt: event.receivedAt,
      sourceIp: event.sourceIp,
      sourcePort: event.sourcePort,
      transport: "udp" as const,
      rawMessage: event.rawMessage,
      rawSize: event.rawSize,
      ingestStatus: "received" as const,
    })));
  },
};

const receiver = createSyslogReceiver(config, writer);
await receiver.start();
console.log(`Syslog receiver listening on ${config.host}:${config.port}/udp`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void receiver.stop().then(() => process.exit(0));
  });
}
