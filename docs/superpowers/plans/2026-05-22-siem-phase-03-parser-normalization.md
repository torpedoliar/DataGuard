# SIEM Phase 03 Parser and Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse raw syslog rows into structured normalized events with generic and vendor-specific event types.

**Architecture:** Keep RFC parsing pure in `lib/siem/syslog-parser.ts`, vendor normalization pure in `lib/siem/normalizers/*`, and DB polling in `scripts/siem-parser-worker.ts`. The worker composes parser + normalizer + later enrichment hooks without losing raw rows on malformed input.

**Tech Stack:** TypeScript, Vitest, Drizzle/Postgres, Node worker script, RTK-wrapped commands.

---

## File Structure

- Create `lib/siem/syslog-parser.ts`: PRI decode, RFC3164, RFC5424, fallback parsing.
- Create `lib/siem/syslog-parser.test.ts`: parser fixture tests.
- Create `lib/siem/normalizers/types.ts`: normalized event contract.
- Create `lib/siem/normalizers/generic.ts`: generic mapping rules.
- Create `lib/siem/normalizers/mikrotik.ts`: MikroTik mapping rules.
- Create `lib/siem/normalizers/cisco.ts`: Cisco mapping rules.
- Create `lib/siem/normalizers/fortigate.ts`: Fortigate mapping rules.
- Create `lib/siem/normalizers/linux.ts`: Linux mapping rules.
- Create `lib/siem/normalizers/*.test.ts`: normalizer tests.
- Create `lib/siem/process-raw-event.ts`: pure parse+normalize orchestration.
- Create `lib/siem/process-raw-event.test.ts`: fallback/non-crash tests.
- Create `scripts/siem-parser-worker.ts`: raw event polling worker.
- Modify `package.json`: add `siem:parser`.

---

### Task 1: Syslog Parser

**Files:**
- Create: `lib/siem/syslog-parser.ts`
- Create: `lib/siem/syslog-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
// lib/siem/syslog-parser.test.ts
import { describe, expect, it } from "vitest";
import { decodePriority, parseSyslogMessage } from "./syslog-parser";

describe("decodePriority", () => {
  it("maps PRI to facility and severity", () => {
    expect(decodePriority(189)).toEqual({ facility: 23, severity: 5 });
    expect(decodePriority(34)).toEqual({ facility: 4, severity: 2 });
  });
});

describe("parseSyslogMessage", () => {
  it("parses RFC3164", () => {
    expect(parseSyslogMessage("<189>May 22 10:15:30 router01 login: failed password for admin from 10.10.1.20")).toMatchObject({
      parser: "rfc3164",
      priority: 189,
      facility: 23,
      severity: 5,
      hostname: "router01",
      program: "login",
      message: "failed password for admin from 10.10.1.20",
    });
  });

  it("parses RFC5424", () => {
    expect(parseSyslogMessage("<34>1 2026-05-22T10:15:30Z host app 123 ID47 - message")).toMatchObject({
      parser: "rfc5424",
      priority: 34,
      facility: 4,
      severity: 2,
      hostname: "host",
      appName: "app",
      processId: "123",
      messageId: "ID47",
      message: "message",
    });
  });

  it("falls back without losing raw message", () => {
    expect(parseSyslogMessage("not syslog")).toMatchObject({ parser: "fallback", message: "not syslog", parseError: "Unsupported syslog format" });
  });
});
```

- [ ] **Step 2: Run parser tests RED**

Run: `rtk npm run test -- lib/siem/syslog-parser.test.ts`

Expected: FAIL because parser file does not exist.

- [ ] **Step 3: Implement parser**

```ts
// lib/siem/syslog-parser.ts
export type ParsedSyslogMessage = {
  parser: "rfc3164" | "rfc5424" | "fallback";
  priority: number | null;
  facility: number | null;
  severity: number | null;
  eventTime: Date | null;
  hostname: string | null;
  appName: string | null;
  program: string | null;
  processId: string | null;
  messageId: string | null;
  structuredData: string | null;
  message: string;
  parseError: string | null;
};

export function decodePriority(priority: number) {
  return { facility: Math.floor(priority / 8), severity: priority % 8 };
}

const rfc5424Pattern = /^<(\d{1,3})>1\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s?(.*)$/;
const rfc3164Pattern = /^<(\d{1,3})>([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+):\s?(.*)$/;

function parseRfc3164Date(value: string) {
  const year = new Date().getFullYear();
  const date = new Date(`${value} ${year}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseSyslogMessage(raw: string): ParsedSyslogMessage {
  const rfc5424 = raw.match(rfc5424Pattern);
  if (rfc5424) {
    const priority = Number(rfc5424[1]);
    const decoded = decodePriority(priority);
    const eventTime = new Date(rfc5424[2]);
    return {
      parser: "rfc5424",
      priority,
      ...decoded,
      eventTime: Number.isNaN(eventTime.getTime()) ? null : eventTime,
      hostname: rfc5424[3] === "-" ? null : rfc5424[3],
      appName: rfc5424[4] === "-" ? null : rfc5424[4],
      program: null,
      processId: rfc5424[5] === "-" ? null : rfc5424[5],
      messageId: rfc5424[6] === "-" ? null : rfc5424[6],
      structuredData: rfc5424[7] === "-" ? null : rfc5424[7],
      message: rfc5424[8] || "",
      parseError: null,
    };
  }

  const rfc3164 = raw.match(rfc3164Pattern);
  if (rfc3164) {
    const priority = Number(rfc3164[1]);
    const decoded = decodePriority(priority);
    return {
      parser: "rfc3164",
      priority,
      ...decoded,
      eventTime: parseRfc3164Date(rfc3164[2]),
      hostname: rfc3164[3],
      appName: null,
      program: rfc3164[4],
      processId: null,
      messageId: null,
      structuredData: null,
      message: rfc3164[5],
      parseError: null,
    };
  }

  return {
    parser: "fallback",
    priority: null,
    facility: null,
    severity: null,
    eventTime: null,
    hostname: null,
    appName: null,
    program: null,
    processId: null,
    messageId: null,
    structuredData: null,
    message: raw,
    parseError: "Unsupported syslog format",
  };
}
```

- [ ] **Step 4: Run parser tests GREEN**

Run: `rtk npm run test -- lib/siem/syslog-parser.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit parser**

Run:

```bash
rtk git add lib/siem/syslog-parser.ts lib/siem/syslog-parser.test.ts && rtk git commit -m "feat: parse syslog messages"
```

Expected: commit succeeds.

---

### Task 2: Normalizer Contract and Generic Normalizer

**Files:**
- Create: `lib/siem/normalizers/types.ts`
- Create: `lib/siem/normalizers/generic.ts`
- Create: `lib/siem/normalizers/generic.test.ts`

- [ ] **Step 1: Write failing generic tests**

```ts
// lib/siem/normalizers/generic.test.ts
import { describe, expect, it } from "vitest";
import { normalizeGeneric } from "./generic";

describe("normalizeGeneric", () => {
  it("detects failed login", () => {
    expect(normalizeGeneric("Failed password for admin from 10.10.1.20 port 22 ssh2")).toMatchObject({
      category: "Authentication",
      normalizedType: "auth_failed",
      outcome: "failure",
      username: "admin",
      srcIp: "10.10.1.20",
    });
  });

  it("detects interface down", () => {
    expect(normalizeGeneric("interface ether1 link down")).toMatchObject({ normalizedType: "interface_down", interfaceName: "ether1" });
  });

  it("detects firewall deny", () => {
    expect(normalizeGeneric("firewall denied tcp from 10.0.0.2 to 10.0.0.3 port 443")).toMatchObject({ normalizedType: "firewall_deny", action: "deny", srcIp: "10.0.0.2", dstIp: "10.0.0.3", dstPort: 443 });
  });
});
```

- [ ] **Step 2: Run generic tests RED**

Run: `rtk npm run test -- lib/siem/normalizers/generic.test.ts`

Expected: FAIL because files are missing.

- [ ] **Step 3: Implement normalizer contract and generic normalizer**

```ts
// lib/siem/normalizers/types.ts
export type NormalizedSyslogEvent = {
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  srcIp: string | null;
  srcPort: number | null;
  dstIp: string | null;
  dstPort: number | null;
  username: string | null;
  interfaceName: string | null;
  protocol: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
};

export function emptyNormalizedEvent(): NormalizedSyslogEvent {
  return { category: null, normalizedType: null, action: null, outcome: null, srcIp: null, srcPort: null, dstIp: null, dstPort: null, username: null, interfaceName: null, protocol: null, tags: [], metadata: {} };
}
```

```ts
// lib/siem/normalizers/generic.ts
import { emptyNormalizedEvent, type NormalizedSyslogEvent } from "./types";

const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function firstIp(message: string) {
  return message.match(ipPattern)?.[0] ?? null;
}

function interfaceName(message: string) {
  return message.match(/interface\s+([A-Za-z0-9_.\/-]+)/i)?.[1] ?? null;
}

function username(message: string) {
  return message.match(/(?:for|user(?:name)?|login)\s+([A-Za-z0-9_.@-]+)/i)?.[1] ?? null;
}

export function normalizeGeneric(message: string): NormalizedSyslogEvent {
  const lower = message.toLowerCase();
  const event = emptyNormalizedEvent();

  if (/(failed password|login failed|invalid user)/i.test(message)) {
    return { ...event, category: "Authentication", normalizedType: "auth_failed", action: "login", outcome: "failure", srcIp: firstIp(message), username: username(message) };
  }
  if (/(accepted password|login success|login successful)/i.test(message)) {
    return { ...event, category: "Authentication", normalizedType: "auth_success", action: "login", outcome: "success", srcIp: firstIp(message), username: username(message) };
  }
  if (/(link down|interface .*down)/i.test(message)) {
    return { ...event, category: "Network", normalizedType: "interface_down", action: "link", outcome: "down", interfaceName: interfaceName(message) };
  }
  if (/(link up|interface .*up)/i.test(message)) {
    return { ...event, category: "Network", normalizedType: "interface_up", action: "link", outcome: "up", interfaceName: interfaceName(message) };
  }
  if (/(denied|drop|blocked)/i.test(message)) {
    const ips = message.match(ipPattern) ?? [];
    const port = Number(message.match(/port\s+(\d+)/i)?.[1] ?? "") || null;
    return { ...event, category: "Firewall", normalizedType: "firewall_deny", action: "deny", outcome: "blocked", srcIp: ips[0] ?? null, dstIp: ips[1] ?? null, dstPort: port, protocol: lower.includes("udp") ? "udp" : lower.includes("tcp") ? "tcp" : null };
  }
  if (/(reboot|restarted|boot)/i.test(message)) return { ...event, category: "System", normalizedType: "device_reboot", action: "restart", outcome: "success" };
  if (/(configured|config changed|commit)/i.test(message)) return { ...event, category: "System", normalizedType: "config_changed", action: "configure", outcome: "success", username: username(message) };
  if (/(temperature|fan|power)/i.test(message)) return { ...event, category: "System", normalizedType: "hardware_alert", action: "alert", outcome: "warning", tags: lower.includes("power") ? ["power"] : ["thermal"] };

  return event;
}
```

- [ ] **Step 4: Run generic tests GREEN**

Run: `rtk npm run test -- lib/siem/normalizers/generic.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit generic normalizer**

Run:

```bash
rtk git add lib/siem/normalizers && rtk git commit -m "feat: normalize generic syslog events"
```

Expected: commit succeeds.

---

### Task 3: Vendor Normalizers

**Files:**
- Create: `lib/siem/normalizers/mikrotik.ts`
- Create: `lib/siem/normalizers/cisco.ts`
- Create: `lib/siem/normalizers/fortigate.ts`
- Create: `lib/siem/normalizers/linux.ts`
- Create: `lib/siem/normalizers/vendor.test.ts`

- [ ] **Step 1: Write failing vendor tests**

```ts
// lib/siem/normalizers/vendor.test.ts
import { describe, expect, it } from "vitest";
import { normalizeCisco } from "./cisco";
import { normalizeFortigate } from "./fortigate";
import { normalizeLinux } from "./linux";
import { normalizeMikrotik } from "./mikrotik";

describe("vendor normalizers", () => {
  it("normalizes Cisco link down", () => {
    expect(normalizeCisco("%LINK-3-UPDOWN: Interface GigabitEthernet1/0/1, changed state to down")).toMatchObject({ normalizedType: "interface_down", interfaceName: "GigabitEthernet1/0/1" });
  });

  it("normalizes Fortigate deny", () => {
    expect(normalizeFortigate("type=traffic action=deny srcip=10.0.0.2 dstip=10.0.0.3 dstport=443 proto=6")).toMatchObject({ normalizedType: "firewall_deny", srcIp: "10.0.0.2", dstIp: "10.0.0.3", dstPort: 443 });
  });

  it("normalizes Linux sudo command", () => {
    expect(normalizeLinux("sudo: admin : TTY=pts/0 ; COMMAND=/bin/systemctl restart nginx")).toMatchObject({ normalizedType: "sudo_command", username: "admin" });
  });

  it("normalizes MikroTik login failure", () => {
    expect(normalizeMikrotik("login failure for user admin from 10.10.1.20 via ssh")).toMatchObject({ normalizedType: "auth_failed", username: "admin", srcIp: "10.10.1.20" });
  });
});
```

- [ ] **Step 2: Run vendor tests RED**

Run: `rtk npm run test -- lib/siem/normalizers/vendor.test.ts`

Expected: FAIL because vendor normalizers are missing.

- [ ] **Step 3: Implement vendor normalizers**

```ts
// lib/siem/normalizers/cisco.ts
import { normalizeGeneric } from "./generic";
export function normalizeCisco(message: string) {
  const link = message.match(/%LINK-\d-UPDOWN: Interface ([^,]+), changed state to (down|up)/i);
  if (link) return { ...normalizeGeneric(`interface ${link[1]} link ${link[2]}`), metadata: { ciscoMnemonic: "LINK-UPDOWN" } };
  const login = /%SEC_LOGIN-\d-LOGIN_FAILED/i.test(message);
  if (login) return { ...normalizeGeneric(`failed password ${message}`), metadata: { ciscoMnemonic: "SEC_LOGIN" } };
  if (/%SYS-5-CONFIG_I/i.test(message)) return { ...normalizeGeneric("config changed"), metadata: { ciscoMnemonic: "SYS-CONFIG" } };
  if (/%SYS-5-RESTART/i.test(message)) return { ...normalizeGeneric("restarted"), metadata: { ciscoMnemonic: "SYS-RESTART" } };
  return normalizeGeneric(message);
}
```

```ts
// lib/siem/normalizers/fortigate.ts
import { emptyNormalizedEvent } from "./types";
function field(message: string, key: string) { return message.match(new RegExp(`${key}=([^\\s]+)`, "i"))?.[1] ?? null; }
export function normalizeFortigate(message: string) {
  const action = field(message, "action");
  if (action === "deny" || action === "blocked") {
    return { ...emptyNormalizedEvent(), category: "Firewall", normalizedType: "firewall_deny", action: "deny", outcome: "blocked", srcIp: field(message, "srcip"), dstIp: field(message, "dstip"), dstPort: Number(field(message, "dstport")) || null, protocol: field(message, "proto"), metadata: { vendor: "fortigate" } };
  }
  if (/vpn/i.test(message) && /fail/i.test(message)) return { ...emptyNormalizedEvent(), category: "Firewall", normalizedType: "vpn_login_failed", action: "login", outcome: "failure", username: field(message, "user"), srcIp: field(message, "remip"), metadata: { vendor: "fortigate" } };
  return emptyNormalizedEvent();
}
```

```ts
// lib/siem/normalizers/linux.ts
import { normalizeGeneric } from "./generic";
export function normalizeLinux(message: string) {
  const sudo = message.match(/sudo:\s+([^\s:]+).*COMMAND=(.+)$/i);
  if (sudo) return { ...normalizeGeneric(message), category: "System", normalizedType: "sudo_command", action: "sudo", outcome: "success", username: sudo[1], metadata: { command: sudo[2] } };
  if (/oom-killer|out of memory/i.test(message)) return { ...normalizeGeneric(message), category: "System", normalizedType: "oom_killer", action: "kill", outcome: "failure" };
  if (/disk.*full|no space left/i.test(message)) return { ...normalizeGeneric(message), category: "System", normalizedType: "disk_full", action: "alert", outcome: "warning" };
  if (/service .*restart|systemd.*started/i.test(message)) return { ...normalizeGeneric(message), category: "System", normalizedType: "service_restart", action: "restart", outcome: "success" };
  return normalizeGeneric(message);
}
```

```ts
// lib/siem/normalizers/mikrotik.ts
import { normalizeGeneric } from "./generic";
export function normalizeMikrotik(message: string) {
  if (/login failure/i.test(message)) return normalizeGeneric(message.replace("login failure", "failed password"));
  if (/logged in/i.test(message)) return normalizeGeneric(message.replace("logged in", "login success"));
  if (/dhcp.*conflict/i.test(message)) return { ...normalizeGeneric(message), category: "Network", normalizedType: "dhcp_conflict", action: "dhcp", outcome: "failure" };
  if (/route.*changed/i.test(message)) return { ...normalizeGeneric(message), category: "Network", normalizedType: "route_change", action: "route", outcome: "success" };
  return normalizeGeneric(message);
}
```

- [ ] **Step 4: Run vendor tests GREEN**

Run: `rtk npm run test -- lib/siem/normalizers/vendor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit vendor normalizers**

Run:

```bash
rtk git add lib/siem/normalizers && rtk git commit -m "feat: add vendor syslog normalizers"
```

Expected: commit succeeds.

---

### Task 4: Parse + Normalize Orchestration

**Files:**
- Create: `lib/siem/process-raw-event.ts`
- Create: `lib/siem/process-raw-event.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

```ts
// lib/siem/process-raw-event.test.ts
import { describe, expect, it } from "vitest";
import { processRawSyslogEvent } from "./process-raw-event";

describe("processRawSyslogEvent", () => {
  it("parses and normalizes a generic event", () => {
    expect(processRawSyslogEvent({ rawMessage: "<34>May 22 10:15:30 host sshd: Failed password for admin from 10.0.0.2", vendor: "generic" })).toMatchObject({
      parser: "rfc3164",
      normalizedType: "auth_failed",
      username: "admin",
      srcIp: "10.0.0.2",
      ingestStatus: "parsed",
    });
  });

  it("keeps malformed raw data as parse_failed", () => {
    expect(processRawSyslogEvent({ rawMessage: "bad", vendor: "generic" })).toMatchObject({ parser: "fallback", message: "bad", ingestStatus: "parse_failed" });
  });
});
```

- [ ] **Step 2: Run orchestration tests RED**

Run: `rtk npm run test -- lib/siem/process-raw-event.test.ts`

Expected: FAIL because file is missing.

- [ ] **Step 3: Implement orchestration**

```ts
// lib/siem/process-raw-event.ts
import { parseSyslogMessage } from "./syslog-parser";
import type { SiemVendor } from "./types";
import { normalizeCisco } from "./normalizers/cisco";
import { normalizeFortigate } from "./normalizers/fortigate";
import { normalizeGeneric } from "./normalizers/generic";
import { normalizeLinux } from "./normalizers/linux";
import { normalizeMikrotik } from "./normalizers/mikrotik";

export function processRawSyslogEvent(input: { rawMessage: string; vendor: SiemVendor }) {
  const parsed = parseSyslogMessage(input.rawMessage);
  const normalizer = input.vendor === "cisco" ? normalizeCisco : input.vendor === "fortigate" ? normalizeFortigate : input.vendor === "linux" ? normalizeLinux : input.vendor === "mikrotik" ? normalizeMikrotik : normalizeGeneric;
  const normalized = normalizer(parsed.message);

  return {
    ...parsed,
    ...normalized,
    ingestStatus: parsed.parser === "fallback" ? "parse_failed" as const : "parsed" as const,
  };
}
```

- [ ] **Step 4: Run orchestration tests GREEN**

Run: `rtk npm run test -- lib/siem/process-raw-event.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit orchestration**

Run:

```bash
rtk git add lib/siem/process-raw-event.ts lib/siem/process-raw-event.test.ts && rtk git commit -m "feat: process raw syslog events"
```

Expected: commit succeeds.

---

### Task 5: Parser Worker Entrypoint

**Files:**
- Create: `scripts/siem-parser-worker.ts`
- Modify: `package.json`

- [ ] **Step 1: Create worker script**

```ts
// scripts/siem-parser-worker.ts
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
```

Modify `package.json` scripts:

```json
"siem:parser": "tsx scripts/siem-parser-worker.ts"
```

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit worker**

Run:

```bash
rtk git add scripts/siem-parser-worker.ts package.json && rtk git commit -m "feat: add SIEM parser worker"
```

Expected: commit succeeds.

---

### Task 6: Phase 03 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run SIEM parser suite**

Run:

```bash
rtk npm run test -- lib/siem/syslog-parser.test.ts lib/siem/normalizers/generic.test.ts lib/siem/normalizers/vendor.test.ts lib/siem/process-raw-event.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual parser check**

After Phase 02 receiver inserts a raw row, run:

```bash
rtk npm run siem:parser
```

Expected: one `syslog_events` row appears and source raw row becomes `parsed` or `parse_failed`.
