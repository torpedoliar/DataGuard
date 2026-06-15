import { describe, expect, it, afterEach } from "vitest";
import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildReceiverConfig,
  buildTcpReceiverConfig,
  buildTlsReceiverConfig,
  createReceiverBuffer,
  createSyslogTcpReceiver,
  createSyslogTlsReceiver,
  decodeSyslogPacket,
  splitTcpFrames,
} from "./receiver";

describe("syslog receiver config", () => {
  it("uses UDP 514 defaults", () => {
    expect(buildReceiverConfig({})).toMatchObject({
      host: "0.0.0.0",
      port: 514,
      maxMessageSize: 16384,
      batchSize: 100,
      flushIntervalMs: 1000,
      queueLimit: 1000,
    });
  });

  it("reads environment overrides", () => {
    expect(buildReceiverConfig({
      SYSLOG_UDP_HOST: "127.0.0.1",
      SYSLOG_UDP_PORT: "5514",
      SYSLOG_MAX_MESSAGE_SIZE: "512",
      SYSLOG_BATCH_SIZE: "10",
      SYSLOG_FLUSH_INTERVAL_MS: "250",
      SYSLOG_QUEUE_LIMIT: "20",
    })).toMatchObject({ host: "127.0.0.1", port: 5514, maxMessageSize: 512, batchSize: 10, flushIntervalMs: 250, queueLimit: 20 });
  });
});

describe("decodeSyslogPacket", () => {
  it("accepts messages at the size limit", () => {
    const result = decodeSyslogPacket(Buffer.from("<34>May 22 host app: ok"), 64);
    expect(result).toEqual({ ok: true, message: "<34>May 22 host app: ok", rawSize: 23 });
  });

  it("rejects oversized messages", () => {
    const result = decodeSyslogPacket(Buffer.from("123456"), 5);
    expect(result).toEqual({ ok: false, reason: "oversized", rawSize: 6 });
  });
});

describe("receiver buffer", () => {
  it("batches inserts when batch size is reached", async () => {
    const batches: unknown[][] = [];
    const buffer = createReceiverBuffer({ batchSize: 2, queueLimit: 5 }, { insertRawEvents: async (events) => { batches.push(events); } });

    await buffer.enqueue({ sourceIp: "10.0.0.1", sourcePort: 514, rawMessage: "one", rawSize: 3, receivedAt: new Date("2026-05-22T00:00:00Z") });
    await buffer.enqueue({ sourceIp: "10.0.0.1", sourcePort: 514, rawMessage: "two", rawSize: 3, receivedAt: new Date("2026-05-22T00:00:01Z") });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(buffer.counters.inserted).toBe(2);
  });

  it("drops newest event when queue is full", async () => {
    const buffer = createReceiverBuffer({ batchSize: 10, queueLimit: 1 }, { insertRawEvents: async () => undefined });

    await buffer.enqueue({ sourceIp: "10.0.0.1", sourcePort: 514, rawMessage: "one", rawSize: 3, receivedAt: new Date() });
    await buffer.enqueue({ sourceIp: "10.0.0.1", sourcePort: 514, rawMessage: "two", rawSize: 3, receivedAt: new Date() });

    expect(buffer.counters.dropped).toBe(1);
    expect(buffer.queueDepth()).toBe(1);
  });
});

describe("splitTcpFrames", () => {
  it("splits on \\n, keeps tail", () => {
    const result = splitTcpFrames(Buffer.from("alpha\nbeta\ngam"), 1024);
    expect(result.messages).toEqual(["alpha", "beta"]);
    expect(result.remaining.toString()).toBe("gam");
    expect(result.oversized).toBe(false);
  });

  it("strips trailing \\r (RFC 6587 non-transparent)", () => {
    const result = splitTcpFrames(Buffer.from("alpha\r\nbeta\r\n"), 1024);
    expect(result.messages).toEqual(["alpha", "beta"]);
  });

  it("flags oversized frames", () => {
    const result = splitTcpFrames(Buffer.from("a".repeat(20) + "\nok\n"), 10);
    expect(result.messages).toEqual(["ok"]);
    expect(result.oversized).toBe(true);
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("could not allocate port")));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

describe("syslog TCP receiver", () => {
  const receivers: { stop: () => Promise<void> }[] = [];

  afterEach(async () => {
    while (receivers.length > 0) {
      const r = receivers.pop();
      if (r) await r.stop();
    }
  });

  function track<T extends { stop: () => Promise<void> }>(r: T): T {
    receivers.push(r);
    return r;
  }

  function readMessages(writer: { insertRawEvents: (e: unknown[]) => Promise<void> }, n: number, timeoutMs = 2000): Promise<{ rawMessage: string; sourceIp: string; sourcePort: number }[]> {
    return new Promise((resolve, reject) => {
      const collected: { rawMessage: string; sourceIp: string; sourcePort: number }[] = [];
      const original = writer.insertRawEvents;
      const timer = setTimeout(() => {
        writer.insertRawEvents = original;
        reject(new Error(`timeout waiting for ${n} messages, got ${collected.length}`));
      }, timeoutMs);
      writer.insertRawEvents = async (events: { rawMessage: string; sourceIp: string; sourcePort: number }[]) => {
        collected.push(...events);
        if (collected.length >= n) {
          clearTimeout(timer);
          writer.insertRawEvents = original;
          resolve(collected);
        }
      };
    });
  }

  it("binds, accepts, and parses \\n-delimited messages", async () => {
    const port = await freePort();
    const writer = { insertRawEvents: async (_e: unknown[]) => undefined };
    const receiver = track(createSyslogTcpReceiver({ port, maxMessageSize: 1024, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, writer));
    await receiver.start();
    const collectedPromise = readMessages(writer, 2);

    const client = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    client.write("<34>first message\n<14>second message\n");
    client.end();

    const collected = await collectedPromise;
    expect(collected.map((c) => c.rawMessage)).toEqual(["<34>first message", "<14>second message"]);
    expect(collected[0].sourcePort).toBeGreaterThan(0);
  });

  it("buffers partial frames across packets", async () => {
    const port = await freePort();
    const writer = { insertRawEvents: async (_e: unknown[]) => undefined };
    const receiver = track(createSyslogTcpReceiver({ port, maxMessageSize: 1024, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, writer));
    await receiver.start();
    const collectedPromise = readMessages(writer, 1);

    const client = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    client.write("<13>par");
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.write("tial message\n");
    client.end();

    const collected = await collectedPromise;
    expect(collected).toHaveLength(1);
    expect(collected[0].rawMessage).toBe("<13>partial message");
  });

  it("rejects oversize messages", async () => {
    const port = await freePort();
    const writer = { insertRawEvents: async (_e: unknown[]) => undefined };
    const receiver = track(createSyslogTcpReceiver({ port, maxMessageSize: 16, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, writer));
    await receiver.start();

    const client = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    client.write("a".repeat(64) + "\n");
    client.end();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receiver.counters.oversized).toBe(1);
    expect(receiver.counters.dropped).toBe(1);
  });
});

describe("syslog TLS receiver", () => {
  const receivers: { stop: () => Promise<void> }[] = [];

  afterEach(async () => {
    while (receivers.length > 0) {
      const r = receivers.pop();
      if (r) await r.stop();
    }
  });

  function track<T extends { stop: () => Promise<void> }>(r: T): T {
    receivers.push(r);
    return r;
  }

  it("throws when cert is missing", () => {
    const writer = { insertRawEvents: async (_e: unknown[]) => undefined };
    expect(() => createSyslogTlsReceiver({ port: 1, certPath: "/nonexistent/cert.pem", keyPath: "/nonexistent/key.pem", maxMessageSize: 1024, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, writer))
      .toThrow(/cert not found/);
  });

  it("throws when key is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syslog-tls-mk-"));
    const certPath = path.join(dir, "cert.pem");
    fs.writeFileSync(certPath, "dummy");
    try {
      const writer = { insertRawEvents: async (_e: unknown[]) => undefined };
      expect(() => createSyslogTlsReceiver({ port: 1, certPath, keyPath: "/nonexistent/key.pem", maxMessageSize: 1024, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, writer))
        .toThrow(/key not found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("binds, accepts TLS, and parses messages", async () => {
    if (!process.env.VITEST_TLS_CERT_PEM || !process.env.VITEST_TLS_KEY_PEM) {
      // skip when no cert is provisioned (CI without fixtures)
      return;
    }
    const port = await freePort();
    const writer = { insertRawEvents: async (_e: unknown[]) => undefined };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syslog-tls-"));
    const certPath = path.join(dir, "cert.pem");
    const keyPath = path.join(dir, "key.pem");
    fs.writeFileSync(certPath, process.env.VITEST_TLS_CERT_PEM);
    fs.writeFileSync(keyPath, process.env.VITEST_TLS_KEY_PEM);
    try {
      const receiver = track(createSyslogTlsReceiver({ port, certPath, keyPath, maxMessageSize: 1024, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, writer));
      await receiver.start();

      const collected: string[] = [];
      const collectedPromise = new Promise<void>((resolve) => {
        const orig = writer.insertRawEvents;
        writer.insertRawEvents = async (events: { rawMessage: string }[]) => {
          collected.push(...events.map((e) => e.rawMessage));
          if (collected.length >= 1) {
            writer.insertRawEvents = orig;
            resolve();
          }
        };
      });

      const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      await new Promise<void>((resolve) => client.once("secureConnect", () => resolve()));
      client.write("<189>secure hello\n");
      client.end();
      await collectedPromise;
      expect(collected[0]).toBe("<189>secure hello");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("transport config builders", () => {
  it("buildTcpReceiverConfig reads SYSLOG_TCP_PORT", () => {
    expect(buildTcpReceiverConfig({ SYSLOG_TCP_PORT: "601" })).toMatchObject({ port: 601 });
  });

  it("buildTlsReceiverConfig returns null when env is incomplete", () => {
    expect(buildTlsReceiverConfig({})).toBeNull();
    expect(buildTlsReceiverConfig({ SYSLOG_TLS_PORT: "6514", TLS_CERT_PATH: "/c" })).toBeNull();
    expect(buildTlsReceiverConfig({ SYSLOG_TLS_PORT: "6514", TLS_CERT_PATH: "/c", TLS_KEY_PATH: "/k" })).toMatchObject({ port: 6514, certPath: "/c", keyPath: "/k" });
  });
});

describe("multiple transports in one process", () => {
  const receivers: { stop: () => Promise<void> }[] = [];
  const sockets: dgram.Socket[] = [];

  afterEach(async () => {
    while (receivers.length > 0) {
      const r = receivers.pop();
      if (r) await r.stop();
    }
    while (sockets.length > 0) {
      const s = sockets.pop();
      if (s) s.close();
    }
  });

  it("runs UDP and TCP concurrently with independent ports", async () => {
    const udpPort = await freePort();
    const tcpPort = await freePort();

    const udpWriter = { insertRawEvents: async (_e: unknown[]) => undefined };
    const tcpWriter = { insertRawEvents: async (_e: unknown[]) => undefined };
    const udpBuffer = createReceiverBuffer({ batchSize: 1, queueLimit: 100 }, udpWriter);
    const udpSocket = dgram.createSocket("udp4");
    sockets.push(udpSocket);
    await new Promise<void>((resolve, reject) => {
      udpSocket.once("error", reject);
      udpSocket.bind(udpPort, () => resolve());
    });
    udpSocket.on("message", (msg) => {
      void udpBuffer.enqueue({
        sourceIp: "127.0.0.1",
        sourcePort: udpPort,
        rawMessage: msg.toString("utf8"),
        rawSize: msg.length,
        receivedAt: new Date(),
      });
    });

    const tcp = createSyslogTcpReceiver({ port: tcpPort, maxMessageSize: 1024, batchSize: 1, queueLimit: 100, flushIntervalMs: 60_000 }, tcpWriter);
    await tcp.start();
    receivers.push({ stop: tcp.stop });

    // Send UDP
    const sender = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      sender.send("udp-msg", udpPort, "127.0.0.1", (err) => err ? reject(err) : resolve());
    });
    sender.close();

    // Send TCP and wait for the writer
    const tcpCollected: string[] = [];
    const tcpDone = new Promise<void>((resolve) => {
      const orig = tcpWriter.insertRawEvents;
      tcpWriter.insertRawEvents = async (events: { rawMessage: string }[]) => {
        tcpCollected.push(...events.map((e) => e.rawMessage));
        if (tcpCollected.length >= 1) {
          tcpWriter.insertRawEvents = orig;
          resolve();
        }
      };
    });
    const client = net.createConnection({ port: tcpPort, host: "127.0.0.1" });
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    client.write("tcp-msg\n");
    client.end();
    await tcpDone;

    expect(tcpCollected[0]).toBe("tcp-msg");
    expect(udpBuffer.counters.received).toBe(1);
    expect(udpBuffer.counters.inserted).toBe(1);
  });
});
