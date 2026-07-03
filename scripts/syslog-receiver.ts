#!/usr/bin/env tsx
import dotenv from "dotenv";
import fs from "node:fs";
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
  type ReceiverCounters,
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

type HealthStatus = {
  updatedAt: string;
  sockets: { transport: string; listening: boolean; address?: string }[];
  counters: ReceiverCounters;
};

const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-syslog-receiver.health.json";
const healthIntervalMs = Number(process.env.SYSLOG_HEALTH_INTERVAL_MS ?? 60_000);
const startupRetryMs = Number(process.env.SYSLOG_STARTUP_RETRY_MS ?? 5_000);

function writeHealth(status: HealthStatus) {
  try {
    fs.writeFileSync(healthFile, JSON.stringify(status), "utf8");
  } catch (error) {
    console.error("Failed to write health file", error);
  }
}

function mergeCounters(handles: { counters: ReceiverCounters; transport: SyslogTransport }[]): ReceiverCounters {
  const out: ReceiverCounters = { received: 0, inserted: 0, dropped: 0, oversized: 0, failed: 0 };
  for (const h of handles) {
    out.received += h.counters.received;
    out.inserted += h.counters.inserted;
    out.dropped += h.counters.dropped;
    out.oversized += h.counters.oversized;
    out.failed += h.counters.failed;
  }
  return out;
}

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
  counters: ReceiverCounters;
  listening: boolean;
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
    counters: r.counters,
    listening: false,
  });
}
if (tcpConfig.port > 0) {
  const r = createSyslogTcpReceiver(tcpConfig, makeWriter("tcp"));
  handles.push({
    start: r.start,
    stop: r.stop,
    transport: "tcp",
    describe: () => `0.0.0.0:${tcpConfig.port}/tcp`,
    counters: r.counters,
    listening: false,
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
      counters: r.counters,
      listening: false,
    });
  } catch (error) {
    console.error("Skipping TLS receiver:", error instanceof Error ? error.message : error);
  }
}

async function publishHealth() {
  writeHealth({
    updatedAt: new Date().toISOString(),
    sockets: handles.map((h) => ({ transport: h.transport, listening: h.listening, address: h.describe() })),
    counters: mergeCounters(handles.map((h) => ({ counters: h.counters, transport: h.transport }))),
  });
}

async function startWithRetry(handle: ReceiverHandle, attempt = 1): Promise<void> {
  try {
    await handle.start();
    handle.listening = true;
    console.log(`Syslog ${handle.transport} receiver listening on ${handle.describe()}`);
  } catch (error) {
    console.error(`Syslog ${handle.transport} receiver start failed (attempt ${attempt}):`, error);
    handle.listening = false;
    await new Promise((resolve) => setTimeout(resolve, startupRetryMs));
    return startWithRetry(handle, attempt + 1);
  }
}

async function main() {
  if (handles.length === 0) {
    console.warn("No syslog receivers configured (set SYSLOG_UDP_PORT to enable).");
  }

  // Start all configured receivers; each retries independently forever.
  await Promise.all(handles.map((h) => startWithRetry(h)));
  await publishHealth();

  // Heartbeat for health checks and observability.
  const healthTimer = setInterval(() => {
    void publishHealth();
    console.log("syslog receiver heartbeat", { counters: mergeCounters(handles.map((h) => ({ counters: h.counters, transport: h.transport }))) });
  }, healthIntervalMs);

  healthTimers.push(healthTimer);
}

const healthTimers: NodeJS.Timeout[] = [];

void main().catch((error) => {
  console.error("Syslog receiver failed to start", error);
  process.exit(1);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const t of healthTimers) clearInterval(t);
  for (const h of handles) {
    try { await h.stop(); } catch { /* ignore */ }
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void shutdown(); });
}
