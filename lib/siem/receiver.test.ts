import { describe, expect, it } from "vitest";
import { buildReceiverConfig, createReceiverBuffer, decodeSyslogPacket } from "./receiver";

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
