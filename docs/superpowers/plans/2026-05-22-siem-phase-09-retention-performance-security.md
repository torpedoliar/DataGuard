# SIEM Phase 09 Retention Performance and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SIEM safe for continuous low-volume production use with retention cleanup, receiver protection, redaction, and UI safety checks.

**Architecture:** Keep security utilities pure and tested in `lib/siem/security.ts`, retention logic in `lib/siem/retention.ts`, and long-running cleanup entrypoint in `scripts/siem-retention-worker.ts`. Add tests that protect against raw HTML rendering regressions.

**Tech Stack:** TypeScript, Drizzle ORM/PostgreSQL, Vitest, Next.js/React source-inspection tests, RTK-wrapped commands.

---

## File Structure

- Create `lib/siem/security.ts`: secret redaction and per-source rate limiter.
- Create `lib/siem/security.test.ts`: redaction and rate limit tests.
- Create `lib/siem/retention.ts`: retention cutoff calculation and deletion plan helpers.
- Create `lib/siem/retention.test.ts`: open findings skip and cutoff tests.
- Create `scripts/siem-retention-worker.ts`: cleanup worker.
- Modify `package.json`: add `siem:retention`.
- Create `components/admin/siem-ui-safety.test.ts`: source-inspection test forbidding `dangerouslySetInnerHTML` in SIEM components.
- Modify `lib/siem/receiver.ts`: optional per-source rate limiter integration.

---

### Task 1: Security Redaction and Rate Limiter

**Files:**
- Create: `lib/siem/security.ts`
- Create: `lib/siem/security.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/siem/security.test.ts
import { describe, expect, it } from "vitest";
import { createSourceRateLimiter, redactSecrets } from "./security";

describe("redactSecrets", () => {
  it("redacts passwords, tokens, api keys, authorization, cookies, and private key fragments", () => {
    const input = "password=abc token: xyz api_key=secret Authorization: Bearer aaa session=bbb -----BEGIN PRIVATE KEY----- data";
    const output = redactSecrets(input);
    expect(output).not.toContain("abc");
    expect(output).not.toContain("xyz");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("Bearer aaa");
    expect(output).not.toContain("bbb");
    expect(output).toContain("[REDACTED]");
  });
});

describe("createSourceRateLimiter", () => {
  it("allows events under limit and blocks over limit", () => {
    const limiter = createSourceRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.allow("1.1.1.1", 0)).toBe(true);
    expect(limiter.allow("1.1.1.1", 100)).toBe(true);
    expect(limiter.allow("1.1.1.1", 200)).toBe(false);
    expect(limiter.allow("1.1.1.1", 1200)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/security.test.ts`

Expected: FAIL because utility does not exist.

- [ ] **Step 3: Implement utilities**

```ts
// lib/siem/security.ts
export function redactSecrets(input: string) {
  return input
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(token\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*)Bearer\s+\S+/gi, "$1[REDACTED]")
    .replace(/(session(?:id)?\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, "[REDACTED_PRIVATE_KEY]");
}

export function createSourceRateLimiter(config: { limit: number; windowMs: number }) {
  const buckets = new Map<string, number[]>();
  return {
    allow(sourceIp: string, now = Date.now()) {
      const since = now - config.windowMs;
      const bucket = (buckets.get(sourceIp) ?? []).filter((timestamp) => timestamp > since);
      if (bucket.length >= config.limit) {
        buckets.set(sourceIp, bucket);
        return false;
      }
      bucket.push(now);
      buckets.set(sourceIp, bucket);
      return true;
    },
  };
}
```

- [ ] **Step 4: Run tests GREEN and commit**

Run:

```bash
rtk npm run test -- lib/siem/security.test.ts
rtk git add lib/siem/security.ts lib/siem/security.test.ts && rtk git commit -m "feat: harden SIEM security helpers"
```

Expected: PASS and commit succeeds.

---

### Task 2: Receiver Rate Limit Integration

**Files:**
- Modify: `lib/siem/receiver.ts`
- Modify: `lib/siem/receiver.test.ts`

- [ ] **Step 1: Add failing test for rate limit**

Append to `lib/siem/receiver.test.ts`:

```ts
import { createSourceRateLimiter } from "./security";

describe("receiver rate limit", () => {
  it("drops over-limit source events", async () => {
    const limiter = createSourceRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow("10.0.0.1", 0)).toBe(true);
    expect(limiter.allow("10.0.0.1", 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `rtk npm run test -- lib/siem/receiver.test.ts lib/siem/security.test.ts`

Expected: PASS after importing from correct path.

- [ ] **Step 3: Add config values**

Extend `ReceiverConfig`:

```ts
rateLimitPerWindow: number;
rateLimitWindowMs: number;
```

Add defaults in `buildReceiverConfig`:

```ts
rateLimitPerWindow: readNumber(env, "SYSLOG_RATE_LIMIT_PER_WINDOW", 1000),
rateLimitWindowMs: readNumber(env, "SYSLOG_RATE_LIMIT_WINDOW_MS", 60000),
```

Inside `createSyslogReceiver`, create limiter:

```ts
const limiter = createSourceRateLimiter({ limit: config.rateLimitPerWindow, windowMs: config.rateLimitWindowMs });
```

Before decode/queue in message handler:

```ts
if (!limiter.allow(remote.address)) {
  buffer.counters.received += 1;
  buffer.counters.dropped += 1;
  return;
}
```

Add import:

```ts
import { createSourceRateLimiter } from "./security";
```

- [ ] **Step 4: Run typecheck and commit**

Run:

```bash
rtk npx tsc --noEmit
rtk git add lib/siem/receiver.ts lib/siem/receiver.test.ts && rtk git commit -m "feat: rate limit syslog receiver"
```

Expected: PASS and commit succeeds.

---

### Task 3: Retention Logic and Worker

**Files:**
- Create: `lib/siem/retention.ts`
- Create: `lib/siem/retention.test.ts`
- Create: `scripts/siem-retention-worker.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing retention tests**

```ts
// lib/siem/retention.test.ts
import { describe, expect, it } from "vitest";
import { buildRetentionCutoffs, shouldDeleteFinding } from "./retention";

describe("retention", () => {
  it("builds cutoffs from settings", () => {
    const now = new Date("2026-05-22T00:00:00Z");
    expect(buildRetentionCutoffs({ rawRetentionDays: 90, eventRetentionDays: 180, findingRetentionDays: 365, alertRetentionDays: 365 }, now).raw.toISOString()).toBe("2026-02-21T00:00:00.000Z");
  });

  it("never deletes open findings", () => {
    expect(shouldDeleteFinding({ status: "Open", updatedAt: new Date("2020-01-01") }, new Date("2026-01-01"))).toBe(false);
    expect(shouldDeleteFinding({ status: "Resolved", updatedAt: new Date("2020-01-01") }, new Date("2026-01-01"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests RED**

Run: `rtk npm run test -- lib/siem/retention.test.ts`

Expected: FAIL because utility does not exist.

- [ ] **Step 3: Implement retention helpers**

```ts
// lib/siem/retention.ts
export function daysAgo(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function buildRetentionCutoffs(settings: { rawRetentionDays: number; eventRetentionDays: number; findingRetentionDays: number; alertRetentionDays: number }, now = new Date()) {
  return { raw: daysAgo(settings.rawRetentionDays, now), events: daysAgo(settings.eventRetentionDays, now), findings: daysAgo(settings.findingRetentionDays, now), alerts: daysAgo(settings.alertRetentionDays, now) };
}

export function shouldDeleteFinding(finding: { status: string; updatedAt: Date | null }, cutoff: Date) {
  return finding.status !== "Open" && Boolean(finding.updatedAt && finding.updatedAt < cutoff);
}
```

- [ ] **Step 4: Create worker script**

```ts
// scripts/siem-retention-worker.ts
#!/usr/bin/env tsx
import dotenv from "dotenv";
import { and, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { siemAlerts, siemFindings, siemSettings, syslogEvents, syslogEventsRaw } from "../db/schema";
import { buildRetentionCutoffs } from "../lib/siem/retention";

dotenv.config();

async function main() {
  const settings = (await db.select().from(siemSettings).limit(1))[0] ?? { rawRetentionDays: 90, eventRetentionDays: 180, findingRetentionDays: 365, alertRetentionDays: 365 };
  const cutoffs = buildRetentionCutoffs(settings);
  const deletedEvents = await db.delete(syslogEvents).where(lt(syslogEvents.receivedAt, cutoffs.events)).returning({ id: syslogEvents.id });
  const deletedRaw = await db.delete(syslogEventsRaw).where(lt(syslogEventsRaw.receivedAt, cutoffs.raw)).returning({ id: syslogEventsRaw.id });
  const deletedAlerts = await db.delete(siemAlerts).where(lt(siemAlerts.createdAt, cutoffs.alerts)).returning({ id: siemAlerts.id });
  const deletedFindings = await db.delete(siemFindings).where(and(ne(siemFindings.status, "Open"), lt(siemFindings.updatedAt, cutoffs.findings))).returning({ id: siemFindings.id });
  console.log({ deletedEvents: deletedEvents.length, deletedRaw: deletedRaw.length, deletedAlerts: deletedAlerts.length, deletedFindings: deletedFindings.length });
}

void main().catch((error) => {
  console.error("SIEM retention worker failed", error);
  process.exit(1);
});
```

Modify `package.json` scripts:

```json
"siem:retention": "tsx scripts/siem-retention-worker.ts"
```

- [ ] **Step 5: Run tests/typecheck and commit**

Run:

```bash
rtk npm run test -- lib/siem/retention.test.ts
rtk npx tsc --noEmit
rtk git add lib/siem/retention.ts lib/siem/retention.test.ts scripts/siem-retention-worker.ts package.json && rtk git commit -m "feat: add SIEM retention worker"
```

Expected: PASS and commit succeeds.

---

### Task 4: UI Safety Regression Test

**Files:**
- Create: `components/admin/siem-ui-safety.test.ts`

- [ ] **Step 1: Create source-inspection test**

```ts
// components/admin/siem-ui-safety.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const siemComponentDir = path.join(process.cwd(), "components/admin");

describe("SIEM UI safety", () => {
  it("does not use dangerouslySetInnerHTML in SIEM components", () => {
    const files = fs.readdirSync(siemComponentDir).filter((file) => file.startsWith("siem-") && file.endsWith(".tsx"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(siemComponentDir, file), "utf8");
      expect(source, file).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
```

- [ ] **Step 2: Run safety test**

Run: `rtk npm run test -- components/admin/siem-ui-safety.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit safety test**

Run:

```bash
rtk git add components/admin/siem-ui-safety.test.ts && rtk git commit -m "test: guard SIEM raw log rendering"
```

Expected: commit succeeds.

---

### Task 5: Phase 09 Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run hardening tests**

Run:

```bash
rtk npm run test -- lib/siem/security.test.ts lib/siem/retention.test.ts components/admin/siem-ui-safety.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck and build**

Run:

```bash
rtk npx tsc --noEmit
rtk npm run build
```

Expected: PASS.

- [ ] **Step 3: Manual retention check**

Run: `rtk npm run siem:retention`

Expected: logs deleted counts and does not delete open findings.
