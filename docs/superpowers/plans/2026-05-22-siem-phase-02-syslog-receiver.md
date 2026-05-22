# SIEM Phase 02 Syslog Receiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate UDP syslog receiver service that listens on UDP 514 and stores raw syslog rows without running parser work inline.

**Architecture:** Build testable receiver internals in `lib/siem/receiver.ts`, keep database insertion behind a small writer interface, and make `scripts/syslog-receiver.ts` only load config and start the service. Docker Compose runs the same script as a separate service with UDP 514 exposed.

**Tech Stack:** Node `dgram`, TypeScript, Drizzle/Postgres, Vitest, Docker Compose, RTK-wrapped commands.

---

## File Structure

- Create `lib/siem/receiver.ts`: config parsing, message validation, bounded queue, batching, counters, UDP service factory.
- Create `lib/siem/receiver.test.ts`: receiver config, size limit, queue behavior, batching, and no parser dependency tests.
- Create `scripts/syslog-receiver.ts`: executable worker entrypoint.
- Modify `package.json`: add `syslog:receiver`.
- Modify `docker-compose.yml`: add `syslog-receiver` service exposing `514:514/udp` with `NET_BIND_SERVICE`.
- Create `scripts/syslog-send-test.ps1`: local Windows UDP sender sample.
- Modify or create `scripts/dockerfile.test.ts` if existing Docker/compose tests inspect services.

---

### Task 1: Receiver Config and Validation

**Files:**
- Create: `lib/siem/receiver.ts`
- Create: `lib/siem/receiver.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/receiver.test.ts
import { describe, expect, it } from "vitest";
import { buildReceiverConfig, decodeSyslogPacket } from "./receiver";

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
```

- [ ] **Step 2: Run test to confirm RED**

Run: `rtk npm run test -- lib/siem/receiver.test.ts`

Expected: FAIL because `lib/siem/receiver.ts` does not exist.

- [ ] **Step 3: Implement config and packet decode**

```ts
// lib/siem/receiver.ts
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
```

- [ ] **Step 4: Run test to confirm GREEN**

Run: `rtk npm run test -- lib/siem/receiver.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit config foundation**

Run:

```bash
rtk git add lib/siem/receiver.ts lib/siem/receiver.test.ts && rtk git commit -m "feat: add syslog receiver config"
```

Expected: commit succeeds.

---

### Task 2: Queue and Batch Flush

**Files:**
- Modify: `lib/siem/receiver.ts`
- Modify: `lib/siem/receiver.test.ts`

- [ ] **Step 1: Add failing queue tests**

Append to `lib/siem/receiver.test.ts`:

```ts
import { createReceiverBuffer } from "./receiver";

describe("receiver buffer", () => {
  it("batches inserts when batch size is reached", async () => {
    const batches: unknown[][] = [];
    const buffer = createReceiverBuffer({ batchSize: 2, queueLimit: 5 }, { insertRawEvents: async (events) => batches.push(events) });

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
```

- [ ] **Step 2: Run test to confirm RED**

Run: `rtk npm run test -- lib/siem/receiver.test.ts`

Expected: FAIL because `createReceiverBuffer` is missing.

- [ ] **Step 3: Implement buffer**

Add to `lib/siem/receiver.ts`:

```ts
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
```

- [ ] **Step 4: Run queue tests**

Run: `rtk npm run test -- lib/siem/receiver.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit queue buffer**

Run:

```bash
rtk git add lib/siem/receiver.ts lib/siem/receiver.test.ts && rtk git commit -m "feat: buffer syslog receiver inserts"
```

Expected: commit succeeds.

---

### Task 3: UDP Service and DB Writer

**Files:**
- Modify: `lib/siem/receiver.ts`
- Create: `scripts/syslog-receiver.ts`
- Modify: `package.json`

- [ ] **Step 1: Add receiver service implementation**

Append to `lib/siem/receiver.ts`:

```ts
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
```

Create script:

```ts
// scripts/syslog-receiver.ts
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
      transport: "udp",
      rawMessage: event.rawMessage,
      rawSize: event.rawSize,
      ingestStatus: "received",
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
```

Modify `package.json` scripts:

```json
"syslog:receiver": "tsx scripts/syslog-receiver.ts"
```

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit service entrypoint**

Run:

```bash
rtk git add lib/siem/receiver.ts scripts/syslog-receiver.ts package.json && rtk git commit -m "feat: add syslog receiver service"
```

Expected: commit succeeds.

---

### Task 4: Docker Compose and Windows Sender

**Files:**
- Modify: `docker-compose.yml`
- Create: `scripts/syslog-send-test.ps1`

- [ ] **Step 1: Add compose service**

Add service after `app`:

```yaml
  syslog-receiver:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: dccheck_syslog_receiver
    restart: unless-stopped
    command: npm run syslog:receiver
    ports:
      - "0.0.0.0:514:514/udp"
    cap_add:
      - NET_BIND_SERVICE
    environment:
      DB_HOST: db
      DB_PORT: "5432"
      DB_USER: administrator
      DB_PASSWORD: "Arabika1927"
      DB_NAME: dccheck
      SYSLOG_UDP_HOST: "0.0.0.0"
      SYSLOG_UDP_PORT: "514"
    depends_on:
      db:
        condition: service_started
    networks:
      - dccheck_net
```

Create sender:

```powershell
# scripts/syslog-send-test.ps1
param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 514,
  [string]$Message = "<34>May 22 10:15:30 test-host sshd: Failed password for admin from 10.10.1.25 port 22 ssh2"
)

$udp = New-Object System.Net.Sockets.UdpClient
$bytes = [Text.Encoding]::UTF8.GetBytes($Message)
[void]$udp.Send($bytes, $bytes.Length, $HostName, $Port)
$udp.Close()
Write-Host "Sent $($bytes.Length) bytes to $HostName`:$Port"
```

- [ ] **Step 2: Validate YAML and TypeScript**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit runtime config**

Run:

```bash
rtk git add docker-compose.yml scripts/syslog-send-test.ps1 && rtk git commit -m "feat: run syslog receiver in docker"
```

Expected: commit succeeds.

---

### Task 5: Phase 02 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run receiver tests**

Run: `rtk npm run test -- lib/siem/receiver.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual Windows packet test**

Run receiver in one terminal:

```powershell
! rtk npm run syslog:receiver
```

Run sender in another prompt:

```powershell
! powershell -ExecutionPolicy Bypass -File scripts/syslog-send-test.ps1
```

Expected: receiver counter shows received/inserted increment and one `syslog_events_raw` row exists.
