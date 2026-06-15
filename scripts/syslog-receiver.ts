#!/usr/bin/env tsx
import dotenv from "dotenv";
import { db } from "../db";
import { syslogEventsRaw } from "../db/schema";
import {
  buildReceiverConfig,
  buildTcpReceiverConfig,
  buildTlsReceiverConfig,
  createSyslogReceiver,
  createSyslogTcpReceiver,
  createSyslogTlsReceiver,
  type RawSyslogWriter,
} from "../lib/siem/receiver";

dotenv.config();

type SyslogTransport = "udp" | "tcp" | "tls";
type TaggedInsert = {
  sourceIp: string;
  sourcePort: number;
  rawMessage: string;
  rawSize: number;
  receivedAt: Date;
  transport: SyslogTransport;
};

// Build a writer that stamps every event with the supplied transport. The
// underlying `syslogEventsRaw` table carries a transport column (udp/tcp/tls)
// so the downstream parser worker can pick the right profile.
function makeWriter(transport: SyslogTransport): RawSyslogWriter {
  return {
    async insertRawEvents(events) {
      if (events.length === 0) return;
      const enriched: TaggedInsert[] = events.map((e) => ({ ...e, transport }));
      await db.insert(syslogEventsRaw).values(enriched.map((event) => ({
        receivedAt: event.receivedAt,
        sourceIp: event.sourceIp,
        sourcePort: event.sourcePort,
        transport: event.transport,
        rawMessage: event.rawMessage,
        rawSize: event.rawSize,
        ingestStatus: "received" as const,
      })));
    },
  };
}

type ReceiverHandle = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  transport: SyslogTransport;
  describe: () => string;
};

const udpConfig = buildReceiverConfig(process.env);
const tcpConfig = buildTcpReceiverConfig(process.env);
const tlsConfig = buildTlsReceiverConfig(process.env);

const handles: ReceiverHandle[] = [];

if (udpConfig.port > 0) {
  const r = createSyslogReceiver(udpConfig, makeWriter("udp"));
  handles.push({
    start: r.start,
    stop: r.stop,
    transport: "udp",
    describe: () => `${udpConfig.host}:${udpConfig.port}/udp`,
  });
}
if (tcpConfig.port > 0) {
  const r = createSyslogTcpReceiver(tcpConfig, makeWriter("tcp"));
  handles.push({
    start: r.start,
    stop: r.stop,
    transport: "tcp",
    describe: () => `0.0.0.0:${tcpConfig.port}/tcp`,
  });
}
if (tlsConfig) {
  try {
    const r = createSyslogTlsReceiver(tlsConfig, makeWriter("tls"));
    handles.push({
      start: r.start,
      stop: r.stop,
      transport: "tls",
      describe: () => `0.0.0.0:${tlsConfig.port}/tcp (TLS)`,
    });
  } catch (error) {
    console.error("Skipping TLS receiver:", error instanceof Error ? error.message : error);
  }
}

async function main() {
  for (const h of handles) {
    await h.start();
    console.log(`Syslog ${h.transport} receiver listening on ${h.describe()}`);
  }
  if (handles.length === 0) {
    console.warn("No syslog receivers configured (set SYSLOG_UDP_PORT to enable).");
  }
}

void main().catch((error) => {
  console.error("Syslog receiver failed to start", error);
  process.exit(1);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const h of handles) {
    try { await h.stop(); } catch { /* ignore */ }
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void shutdown(); });
}
