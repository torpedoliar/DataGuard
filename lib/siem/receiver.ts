import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";

export type ReceiverConfig = {
  host: string;
  port: number;
  maxMessageSize: number;
  batchSize: number;
  flushIntervalMs: number;
  queueLimit: number;
};

export type TcpReceiverConfig = {
  port: number;
  maxMessageSize: number;
  batchSize: number;
  queueLimit: number;
  flushIntervalMs: number;
};

export type TlsReceiverConfig = TcpReceiverConfig & {
  certPath: string;
  keyPath: string;
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

export function buildTcpReceiverConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): TcpReceiverConfig {
  return {
    port: readNumber(env, "SYSLOG_TCP_PORT", 0),
    maxMessageSize: readNumber(env, "SYSLOG_MAX_MESSAGE_SIZE", 16384),
    batchSize: readNumber(env, "SYSLOG_BATCH_SIZE", 100),
    queueLimit: readNumber(env, "SYSLOG_QUEUE_LIMIT", 1000),
    flushIntervalMs: readNumber(env, "SYSLOG_FLUSH_INTERVAL_MS", 1000),
  };
}

export function buildTlsReceiverConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): TlsReceiverConfig | null {
  const port = readNumber(env, "SYSLOG_TLS_PORT", 0);
  const certPath = env.TLS_CERT_PATH;
  const keyPath = env.TLS_KEY_PATH;
  if (!port || !certPath || !keyPath) return null;
  return {
    port,
    certPath,
    keyPath,
    maxMessageSize: readNumber(env, "SYSLOG_MAX_MESSAGE_SIZE", 16384),
    batchSize: readNumber(env, "SYSLOG_BATCH_SIZE", 100),
    queueLimit: readNumber(env, "SYSLOG_QUEUE_LIMIT", 1000),
    flushIntervalMs: readNumber(env, "SYSLOG_FLUSH_INTERVAL_MS", 1000),
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

// Frame a TCP byte stream into newline-delimited syslog messages (RFC 6587
// non-transparent framing). Returns the messages and the remaining incomplete
// tail that should be prepended on the next packet.
export function splitTcpFrames(buffer: Buffer, maxMessageSize: number): { messages: string[]; remaining: Buffer; oversized: boolean } {
  const messages: string[] = [];
  let oversized = false;
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) {
      const slice = buffer.subarray(start, i);
      // strip optional trailing \r (RFC 6587 non-transparent allows it)
      const trimmed = slice.length > 0 && slice[slice.length - 1] === 0x0d ? slice.subarray(0, slice.length - 1) : slice;
      if (trimmed.length > maxMessageSize) {
        oversized = true;
      } else if (trimmed.length > 0) {
        messages.push(trimmed.toString("utf8"));
      }
      start = i + 1;
    }
  }
  return { messages, remaining: buffer.subarray(start), oversized };
}

export function createSyslogTcpReceiver(config: TcpReceiverConfig, writer: RawSyslogWriter) {
  const buffer = createReceiverBuffer(config, writer);
  const server = net.createServer((socket) => {
    let tail: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      const merged = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
      if (merged.length > config.maxMessageSize && tail.length === 0) {
        // Single chunk exceeds the limit; reject by counting and dropping
        buffer.counters.received += 1;
        buffer.counters.oversized += 1;
        buffer.counters.dropped += 1;
        return;
      }
      const { messages, remaining, oversized } = splitTcpFrames(merged, config.maxMessageSize);
      tail = remaining;
      for (const message of messages) {
        void buffer.enqueue({
          sourceIp: socket.remoteAddress ?? "unknown",
          sourcePort: socket.remotePort ?? 0,
          rawMessage: message,
          rawSize: Buffer.byteLength(message, "utf8"),
          receivedAt: new Date(),
        });
      }
      if (oversized) {
        buffer.counters.oversized += 1;
        buffer.counters.dropped += 1;
      }
    });
    socket.on("error", () => {
      // swallow socket errors so one bad client doesn't kill the server
    });
  });

  const flushTimer = setInterval(() => void buffer.flush(), config.flushIntervalMs);
  const healthTimer = setInterval(() => {
    console.log("syslog tcp receiver", { ...buffer.counters, queueDepth: buffer.queueDepth() });
  }, 60_000);

  return {
    counters: buffer.counters,
    start: () => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, () => {
        server.off("error", reject);
        resolve();
      });
    }),
    stop: () => new Promise<void>((resolve) => {
      clearInterval(flushTimer);
      clearInterval(healthTimer);
      server.close(() => resolve());
    }),
    address: () => server.address() as net.AddressInfo | null,
  };
}

export function createSyslogTlsReceiver(config: TlsReceiverConfig, writer: RawSyslogWriter) {
  if (!fs.existsSync(config.certPath)) {
    throw new Error(`TLS cert not found at ${config.certPath}`);
  }
  if (!fs.existsSync(config.keyPath)) {
    throw new Error(`TLS key not found at ${config.keyPath}`);
  }
  const cert = fs.readFileSync(config.certPath);
  const key = fs.readFileSync(config.keyPath);
  const buffer = createReceiverBuffer(config, writer);
  const server = tls.createServer({ cert, key }, (socket) => {
    let tail: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      const merged = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
      if (merged.length > config.maxMessageSize && tail.length === 0) {
        buffer.counters.received += 1;
        buffer.counters.oversized += 1;
        buffer.counters.dropped += 1;
        return;
      }
      const { messages, remaining, oversized } = splitTcpFrames(merged, config.maxMessageSize);
      tail = remaining;
      for (const message of messages) {
        void buffer.enqueue({
          sourceIp: socket.remoteAddress ?? "unknown",
          sourcePort: socket.remotePort ?? 0,
          rawMessage: message,
          rawSize: Buffer.byteLength(message, "utf8"),
          receivedAt: new Date(),
        });
      }
      if (oversized) {
        buffer.counters.oversized += 1;
        buffer.counters.dropped += 1;
      }
    });
    socket.on("error", () => {
      // ignore per-socket errors
    });
  });

  const flushTimer = setInterval(() => void buffer.flush(), config.flushIntervalMs);
  const healthTimer = setInterval(() => {
    console.log("syslog tls receiver", { ...buffer.counters, queueDepth: buffer.queueDepth() });
  }, 60_000);

  return {
    counters: buffer.counters,
    start: () => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, () => {
        server.off("error", reject);
        resolve();
      });
    }),
    stop: () => new Promise<void>((resolve) => {
      clearInterval(flushTimer);
      clearInterval(healthTimer);
      server.close(() => resolve());
    }),
    address: () => server.address() as net.AddressInfo | null,
  };
}
