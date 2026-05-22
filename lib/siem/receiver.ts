import dgram from "node:dgram";

export type ReceiverConfig = {
  host: string;
  port: number;
  maxMessageSize: number;
  batchSize: number;
  flushIntervalMs: number;
  queueLimit: number;
};

export type RawSyslogInsert = {
  sourceIp: string;
  sourcePort: number;
  rawMessage: string;
  rawSize: number;
  receivedAt: Date;
};

export type RawSyslogWriter = {
  insertRawEvents(events: RawSyslogInsert[]): Promise<void>;
};

export type ReceiverCounters = {
  received: number;
  inserted: number;
  dropped: number;
  oversized: number;
  failed: number;
};

function readNumber(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string, fallback: number) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildReceiverConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): ReceiverConfig {
  return {
    host: env.SYSLOG_UDP_HOST || "0.0.0.0",
    port: readNumber(env, "SYSLOG_UDP_PORT", 514),
    maxMessageSize: readNumber(env, "SYSLOG_MAX_MESSAGE_SIZE", 16384),
    batchSize: readNumber(env, "SYSLOG_BATCH_SIZE", 100),
    flushIntervalMs: readNumber(env, "SYSLOG_FLUSH_INTERVAL_MS", 1000),
    queueLimit: readNumber(env, "SYSLOG_QUEUE_LIMIT", 1000),
  };
}

export function decodeSyslogPacket(buffer: Buffer, maxMessageSize: number) {
  if (buffer.length > maxMessageSize) return { ok: false as const, reason: "oversized" as const, rawSize: buffer.length };
  return { ok: true as const, message: buffer.toString("utf8"), rawSize: buffer.length };
}

export function createReceiverBuffer(
  config: Pick<ReceiverConfig, "batchSize" | "queueLimit">,
  writer: RawSyslogWriter,
) {
  const queue: RawSyslogInsert[] = [];
  const counters: ReceiverCounters = { received: 0, inserted: 0, dropped: 0, oversized: 0, failed: 0 };

  async function flush() {
    if (queue.length === 0) return;
    const batch = queue.splice(0, config.batchSize);
    try {
      await writer.insertRawEvents(batch);
      counters.inserted += batch.length;
    } catch {
      counters.failed += batch.length;
      queue.unshift(...batch.slice(0, Math.max(0, config.queueLimit - queue.length)));
    }
  }

  return {
    counters,
    queueDepth: () => queue.length,
    async enqueue(event: RawSyslogInsert) {
      counters.received += 1;
      if (queue.length >= config.queueLimit) {
        counters.dropped += 1;
        return;
      }
      queue.push(event);
      if (queue.length >= config.batchSize) await flush();
    },
    flush,
  };
}

export function createSyslogReceiver(config: ReceiverConfig, writer: RawSyslogWriter) {
  const socket = dgram.createSocket("udp4");
  const buffer = createReceiverBuffer(config, writer);

  socket.on("message", (message, remote) => {
    const decoded = decodeSyslogPacket(message, config.maxMessageSize);
    if (!decoded.ok) {
      buffer.counters.received += 1;
      buffer.counters.oversized += 1;
      buffer.counters.dropped += 1;
      return;
    }

    void buffer.enqueue({
      sourceIp: remote.address,
      sourcePort: remote.port,
      rawMessage: decoded.message,
      rawSize: decoded.rawSize,
      receivedAt: new Date(),
    });
  });

  const flushTimer = setInterval(() => void buffer.flush(), config.flushIntervalMs);
  const healthTimer = setInterval(() => {
    console.log("syslog receiver", { ...buffer.counters, queueDepth: buffer.queueDepth() });
  }, 60_000);

  return {
    counters: buffer.counters,
    start: () => new Promise<void>((resolve) => socket.bind(config.port, config.host, resolve)),
    stop: () => new Promise<void>((resolve) => {
      clearInterval(flushTimer);
      clearInterval(healthTimer);
      socket.close(() => resolve());
    }),
  };
}
