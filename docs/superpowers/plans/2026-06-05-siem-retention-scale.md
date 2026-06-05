# SIEM Retention Per-Source + Partition Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale SIEM log storage to tens of millions of rows with per-source retention and automatic deletion, while never destroying a SIEM finding or the specific events it references.

**Architecture:** Convert `syslog_events_raw` + `syslog_events` to weekly RANGE-partitioned tables (fast `DROP` for bulk expiry, no bloat). Add per-source retention overrides on `syslog_sources`. Before any deletion, archive finding-referenced events into a new non-partitioned `siem_evidence_events` table so evidence survives partition drops. The retention worker runs three ordered phases: archive evidence → drop fully-expired partitions → precise per-source batched delete for short-retention sources still inside live partitions.

**Tech Stack:** TypeScript, Next.js 16 (App Router, server actions), Drizzle ORM (`drizzle-orm/node-postgres`), PostgreSQL 14+ (native declarative partitioning), Vitest (pure-function unit tests, no live DB), Zod.

---

## Conventions (read before starting)

- **Tests are pure functions only.** This repo's `*.test.ts` files never touch a live database (see `lib/siem/retention.test.ts`). All TDD tasks below test pure helper functions. Database/worker/UI code is verified with `npm run lint` and `npm run build`, NOT unit tests.
- **Run a single test file:** `npx vitest run lib/siem/<name>.test.ts`
- **Run all tests:** `npm run test`
- **Lint:** `npm run lint`
- **Build:** `npm run build`
- **Migrations are hand-written SQL** in `drizzle/NNNN_name.sql`, registered in `drizzle/meta/_journal.json`, applied with `npm run db:migrate`. Do NOT use `drizzle-kit push` for these changes.
- **Import style:** within `lib/siem/` use relative imports (`../../db`); in `app/` and `actions/` use the `@/` alias.
- **Commit after every task.** Use the exact commit commands shown.
- The retention worker entrypoint `scripts/siem-retention-worker.ts` already exists and calls `runSiemRetentionCleanup` — you do NOT create it, only its dependencies change.

---

## File Structure

**Created:**
- `lib/siem/partitioning.ts` — pure helpers: week keys, partition names, week ranges, which partitions to pre-create, whether a partition is fully expired.
- `lib/siem/partitioning.test.ts` — tests for the above.
- `lib/siem/evidence.ts` — pure `buildEvidenceSnapshot()` mapper + DB helpers `archiveFindingEvidence()` and `getFindingEvidence()`.
- `lib/siem/evidence.test.ts` — tests for `buildEvidenceSnapshot`.
- `drizzle/0008_siem_retention_scale.sql` — additive schema (evidence table, source retention columns, finding flag).
- `scripts/siem-partition-migrate.ts` — one-time script that rebuilds the two log tables as partitioned tables, copying existing data.

**Modified:**
- `db/schema.ts` — add `siemEvidenceEvents` table, `syslog_sources` retention columns, `siem_findings.evidence_archived`, relations.
- `drizzle/meta/_journal.json` — register migration `0008`.
- `lib/siem/retention.ts` — add pure `resolveSourceCutoffDays()` + `mostLenientEventCutoff()`; rewrite `runSiemRetentionCleanup()` into 3 phases + partition maintenance.
- `lib/siem/retention.test.ts` — add tests for the new pure helpers.
- `actions/siem-sources.ts` — accept + validate + persist per-source retention.
- `components/admin/siem-source-table.tsx` — retention input fields + display column.
- `actions/siem-ai.ts` — read evidence via `getFindingEvidence()` instead of querying `syslogEvents` directly.

---

## Task 1: Schema — evidence table, per-source retention, finding flag

**Files:**
- Modify: `db/schema.ts` (after `siemSettings`, around line 608)
- Create: `drizzle/0008_siem_retention_scale.sql`
- Modify: `drizzle/meta/_journal.json`

This task is additive DDL only (no partitioning yet). Verified by build, not unit test.

- [ ] **Step 1: Add retention columns to `syslog_sources` in `db/schema.ts`**

Find the `syslogSources` table (starts at `export const syslogSources = pgTable("syslog_sources", {`). Add two columns immediately after the `eventCount` line (`eventCount: integer("event_count").notNull().default(0),`):

```ts
  eventCount: integer("event_count").notNull().default(0),
  rawRetentionDays: integer("raw_retention_days"),
  eventRetentionDays: integer("event_retention_days"),
```

(Leave the rest of the table — `createdAt`, `updatedAt`, the index block — unchanged.)

- [ ] **Step 2: Add `evidenceArchived` flag to `siem_findings` in `db/schema.ts`**

Find the `siemFindings` table. Add this column immediately after the `sampleEventIds` line (`sampleEventIds: jsonb("sample_event_ids").$type<number[]>().notNull().default(sql\`'[]'::jsonb\`),`):

```ts
  sampleEventIds: jsonb("sample_event_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  evidenceArchived: boolean("evidence_archived").notNull().default(false),
```

- [ ] **Step 3: Add the `siemEvidenceEvents` table to `db/schema.ts`**

Insert this block immediately AFTER the closing `});` of the `siemSettings` table (i.e. after the line that ends the `siemSettings` definition, before the `auditLogsRelations` block):

```ts
export const siemEvidenceEvents = pgTable("siem_evidence_events", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id).notNull(),
  originalEventId: integer("original_event_id").notNull(),
  eventTime: timestamp("event_time"),
  receivedAt: timestamp("received_at").notNull(),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  deviceId: integer("device_id").references(() => devices.id),
  sourceId: integer("source_id").references(() => syslogSources.id),
  message: text("message").notNull(),
  rawMessage: text("raw_message"),
  category: text("category"),
  normalizedType: text("normalized_type"),
  action: text("action"),
  outcome: text("outcome"),
  srcIp: text("src_ip"),
  dstIp: text("dst_ip"),
  username: text("username"),
  severity: integer("severity"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  archivedAt: timestamp("archived_at").defaultNow(),
}, (table) => ({
  findingIdx: index("siem_evidence_events_finding_idx").on(table.findingId),
  originalIdx: index("siem_evidence_events_original_idx").on(table.originalEventId),
}));
```

- [ ] **Step 4: Add relation for the evidence table in `db/schema.ts`**

Insert this immediately after the `siemFindingsRelations` block (find `export const siemFindingsRelations = relations(siemFindings,`; add after its closing `}));`):

```ts
export const siemEvidenceEventsRelations = relations(siemEvidenceEvents, ({ one }) => ({
  finding: one(siemFindings, {
    fields: [siemEvidenceEvents.findingId],
    references: [siemFindings.id],
  }),
}));
```

- [ ] **Step 5: Verify schema compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors). If `tsc` is slow, instead run `npm run build` and expect it to compile the schema without type errors.

- [ ] **Step 6: Write the migration SQL `drizzle/0008_siem_retention_scale.sql`**

```sql
ALTER TABLE "syslog_sources" ADD COLUMN "raw_retention_days" integer;--> statement-breakpoint
ALTER TABLE "syslog_sources" ADD COLUMN "event_retention_days" integer;--> statement-breakpoint
ALTER TABLE "siem_findings" ADD COLUMN "evidence_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "siem_evidence_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"original_event_id" integer NOT NULL,
	"event_time" timestamp,
	"received_at" timestamp NOT NULL,
	"source_ip" text NOT NULL,
	"hostname" text,
	"device_id" integer,
	"source_id" integer,
	"message" text NOT NULL,
	"raw_message" text,
	"category" text,
	"normalized_type" text,
	"action" text,
	"outcome" text,
	"src_ip" text,
	"dst_ip" text,
	"username" text,
	"severity" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp DEFAULT now()
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siem_evidence_events" ADD CONSTRAINT "siem_evidence_events_finding_id_siem_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."siem_findings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siem_evidence_events" ADD CONSTRAINT "siem_evidence_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "siem_evidence_events" ADD CONSTRAINT "siem_evidence_events_source_id_syslog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."syslog_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_evidence_events_finding_idx" ON "siem_evidence_events" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siem_evidence_events_original_idx" ON "siem_evidence_events" USING btree ("original_event_id");
```

- [ ] **Step 7: Register migration `0008` in `drizzle/meta/_journal.json`**

Open `drizzle/meta/_journal.json`. The `entries` array currently ends with the `0007_abandoned_the_initiative` object. Add a new object as the LAST element of the `entries` array (add a comma after the `0007` closing `}`):

```json
    {
      "idx": 8,
      "version": "7",
      "when": 1780622000000,
      "tag": "0008_siem_retention_scale",
      "breakpoints": true
    }
```

- [ ] **Step 8: Commit**

```bash
git add db/schema.ts drizzle/0008_siem_retention_scale.sql drizzle/meta/_journal.json
git commit -m "feat(siem): add evidence table, per-source retention, finding archive flag"
```

---

## Task 2: Pure partitioning helpers

**Files:**
- Create: `lib/siem/partitioning.ts`
- Test: `lib/siem/partitioning.test.ts`

Pure functions only. These compute partition names and ranges from dates. ISO-week is avoided (off-by-one prone); we use a simple fixed 7-day bucketing anchored at a Monday epoch so ranges never overlap and are trivially testable.

- [ ] **Step 1: Write the failing test `lib/siem/partitioning.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  weekStart,
  partitionSuffix,
  partitionName,
  weekRange,
  partitionsForWindow,
  isPartitionFullyExpired,
} from "./partitioning";

describe("siem partitioning", () => {
  it("snaps a date down to the Monday 00:00 UTC of its week", () => {
    // 2026-06-05 is a Friday; its week starts Monday 2026-06-01
    const start = weekStart(new Date("2026-06-05T13:45:00.000Z"));
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns the same Monday when the date already is that Monday", () => {
    const start = weekStart(new Date("2026-06-01T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("builds a stable suffix from the week start", () => {
    expect(partitionSuffix(new Date("2026-06-05T13:45:00.000Z"))).toBe("20260601");
  });

  it("builds partition table names per base table", () => {
    const date = new Date("2026-06-05T13:45:00.000Z");
    expect(partitionName("syslog_events", date)).toBe("syslog_events_p20260601");
    expect(partitionName("syslog_events_raw", date)).toBe("syslog_events_raw_p20260601");
  });

  it("returns a half-open [start, end) week range of exactly 7 days", () => {
    const range = weekRange(new Date("2026-06-05T13:45:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("lists partitions covering a window from weeksBack to weeksAhead inclusive", () => {
    const now = new Date("2026-06-05T13:45:00.000Z");
    const weeks = partitionsForWindow(now, 1, 1);
    expect(weeks.map((w) => w.suffix)).toEqual(["20260525", "20260601", "20260608"]);
  });

  it("treats a partition as fully expired only when its end is at or before the cutoff", () => {
    const range = weekRange(new Date("2026-06-01T00:00:00.000Z")); // ends 2026-06-08
    expect(isPartitionFullyExpired(range, new Date("2026-06-08T00:00:00.000Z"))).toBe(true);
    expect(isPartitionFullyExpired(range, new Date("2026-06-09T00:00:00.000Z"))).toBe(true);
    expect(isPartitionFullyExpired(range, new Date("2026-06-07T23:59:59.000Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/siem/partitioning.test.ts`
Expected: FAIL — cannot find module `./partitioning`.

- [ ] **Step 3: Write `lib/siem/partitioning.ts`**

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export type WeekRange = {
  start: Date;
  end: Date; // half-open: [start, end)
  suffix: string;
};

/**
 * Snap a date down to 00:00:00 UTC of the Monday that begins its week.
 * Uses a fixed Monday epoch so buckets never overlap and are timezone-stable.
 */
export function weekStart(date: Date): Date {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dow = new Date(utcMidnight).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0, Sun=6
  return new Date(utcMidnight - daysSinceMonday * MS_PER_DAY);
}

/** Compact YYYYMMDD suffix of the week start, used in partition table names. */
export function partitionSuffix(date: Date): string {
  const start = weekStart(date);
  const y = start.getUTCFullYear().toString().padStart(4, "0");
  const m = (start.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = start.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Full partition table name for a base table and a date. */
export function partitionName(baseTable: string, date: Date): string {
  return `${baseTable}_p${partitionSuffix(date)}`;
}

/** Half-open [start, end) range for the week containing `date`. */
export function weekRange(date: Date): WeekRange {
  const start = weekStart(date);
  const end = new Date(start.getTime() + MS_PER_WEEK);
  return { start, end, suffix: partitionSuffix(start) };
}

/**
 * Weeks covering [now - weeksBack ... now + weeksAhead], inclusive, ascending.
 * Used to pre-create upcoming partitions (and re-assert recent ones idempotently).
 */
export function partitionsForWindow(now: Date, weeksBack: number, weeksAhead: number): WeekRange[] {
  const current = weekStart(now);
  const weeks: WeekRange[] = [];
  for (let i = -weeksBack; i <= weeksAhead; i++) {
    weeks.push(weekRange(new Date(current.getTime() + i * MS_PER_WEEK)));
  }
  return weeks;
}

/** A partition is fully expired when its whole range is at/older than the cutoff. */
export function isPartitionFullyExpired(range: WeekRange, cutoff: Date): boolean {
  return range.end.getTime() <= cutoff.getTime();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/siem/partitioning.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/siem/partitioning.ts lib/siem/partitioning.test.ts
git commit -m "feat(siem): add pure partition naming and range helpers"
```

---

## Task 3: Pure per-source cutoff resolvers

**Files:**
- Modify: `lib/siem/retention.ts`
- Test: `lib/siem/retention.test.ts`

Adds pure helpers that decide each source's cutoff (its override or the global default) and the most-lenient cutoff across all sources (the threshold below which partitions may be dropped wholesale).

- [ ] **Step 1: Add failing tests to `lib/siem/retention.test.ts`**

Append these two `it` blocks INSIDE the existing `describe("SIEM retention", () => { ... })` block (before its closing `});`). Also update the import on line 2 to include the new symbols:

Change line 2 from:
```ts
import { buildSiemRetentionCutoffs, DEFAULT_SIEM_RETENTION_DAYS, normalizeRetentionDays } from "./retention";
```
to:
```ts
import { buildSiemRetentionCutoffs, DEFAULT_SIEM_RETENTION_DAYS, normalizeRetentionDays, resolveSourceCutoffDays, mostLenientEventCutoff } from "./retention";
```

Then append:

```ts
  it("resolves a source cutoff using its override, falling back to the global default", () => {
    expect(resolveSourceCutoffDays(30, 180)).toBe(30);
    expect(resolveSourceCutoffDays(null, 180)).toBe(180);
    expect(resolveSourceCutoffDays(0, 180)).toBe(180); // invalid override → global
    expect(resolveSourceCutoffDays(-5, 180)).toBe(180);
  });

  it("computes the most lenient event cutoff across sources and the global default", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    // sources: 7d override, null (uses global 180), 30d override; global 180
    const cutoff = mostLenientEventCutoff(
      [{ eventRetentionDays: 7 }, { eventRetentionDays: null }, { eventRetentionDays: 30 }],
      180,
      now,
    );
    // most lenient = 180 days back
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("uses the largest override when it exceeds the global default", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    const cutoff = mostLenientEventCutoff(
      [{ eventRetentionDays: 400 }, { eventRetentionDays: 30 }],
      180,
      now,
    );
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/siem/retention.test.ts`
Expected: FAIL — `resolveSourceCutoffDays`/`mostLenientEventCutoff` are not exported.

- [ ] **Step 3: Add the pure helpers to `lib/siem/retention.ts`**

Insert these functions immediately after the existing `normalizeRetentionDays` function (after its closing `}`, before `function cutoff(...)`):

```ts
/** A source's effective retention days: its override if valid, else the global default. */
export function resolveSourceCutoffDays(override: number | null | undefined, globalDays: number): number {
  if (!Number.isFinite(override) || !override || (override as number) < 1) return globalDays;
  return Math.floor(override as number);
}

/**
 * The cutoff date below which a whole partition may be dropped: now minus the
 * LARGEST retention across all sources (and the global default). Any data older
 * than this is expired for every source, so the partition is safe to drop.
 */
export function mostLenientEventCutoff(
  sources: Array<{ eventRetentionDays: number | null }>,
  globalDays: number,
  now: Date,
): Date {
  let maxDays = globalDays;
  for (const source of sources) {
    maxDays = Math.max(maxDays, resolveSourceCutoffDays(source.eventRetentionDays, globalDays));
  }
  return new Date(now.getTime() - maxDays * MS_PER_DAY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/siem/retention.test.ts`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add lib/siem/retention.ts lib/siem/retention.test.ts
git commit -m "feat(siem): add pure per-source retention cutoff resolvers"
```

---

## Task 4: Evidence snapshot builder + DB helpers

**Files:**
- Create: `lib/siem/evidence.ts`
- Test: `lib/siem/evidence.test.ts`

`buildEvidenceSnapshot` is pure (mapping a joined event row → an evidence insert row) and is unit-tested. `archiveFindingEvidence` and `getFindingEvidence` are thin DB wrappers verified by build.

- [ ] **Step 1: Write the failing test `lib/siem/evidence.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildEvidenceSnapshot, type JoinedEventRow } from "./evidence";

const baseRow: JoinedEventRow = {
  id: 42,
  eventTime: new Date("2026-06-01T10:00:00.000Z"),
  receivedAt: new Date("2026-06-01T10:00:01.000Z"),
  sourceIp: "10.0.0.5",
  hostname: "fw-01",
  deviceId: 7,
  sourceId: 3,
  message: "login failed",
  rawMessage: "<13>Jun 1 10:00:00 fw-01 login failed",
  category: "Authentication",
  normalizedType: "auth.login_failed",
  action: "login",
  outcome: "failure",
  srcIp: "192.168.1.9",
  dstIp: "10.0.0.5",
  username: "admin",
  severity: 4,
  metadata: { vendor: "fortigate" },
};

describe("buildEvidenceSnapshot", () => {
  it("copies all evidence columns and stamps the finding + original event id", () => {
    const snap = buildEvidenceSnapshot(99, baseRow);
    expect(snap).toMatchObject({
      findingId: 99,
      originalEventId: 42,
      sourceIp: "10.0.0.5",
      message: "login failed",
      rawMessage: "<13>Jun 1 10:00:00 fw-01 login failed",
      normalizedType: "auth.login_failed",
      username: "admin",
      severity: 4,
      metadata: { vendor: "fortigate" },
    });
  });

  it("self-contains rawMessage so the snapshot survives deletion of the raw row", () => {
    const snap = buildEvidenceSnapshot(99, baseRow);
    expect(snap.rawMessage).toBe("<13>Jun 1 10:00:00 fw-01 login failed");
  });

  it("defaults a null metadata to an empty object", () => {
    const snap = buildEvidenceSnapshot(99, { ...baseRow, metadata: null });
    expect(snap.metadata).toEqual({});
  });

  it("preserves nullable fields as null", () => {
    const snap = buildEvidenceSnapshot(99, { ...baseRow, hostname: null, rawMessage: null, username: null });
    expect(snap.hostname).toBeNull();
    expect(snap.rawMessage).toBeNull();
    expect(snap.username).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/siem/evidence.test.ts`
Expected: FAIL — cannot find module `./evidence`.

- [ ] **Step 3: Write `lib/siem/evidence.ts`**

```ts
import { db } from "../../db";
import { siemEvidenceEvents, siemFindings, syslogEvents, syslogEventsRaw } from "../../db/schema";
import { and, eq, inArray } from "drizzle-orm";

/** Shape of a syslog_events row left-joined with its raw message. */
export type JoinedEventRow = {
  id: number;
  eventTime: Date | null;
  receivedAt: Date;
  sourceIp: string;
  hostname: string | null;
  deviceId: number | null;
  sourceId: number | null;
  message: string;
  rawMessage: string | null;
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  srcIp: string | null;
  dstIp: string | null;
  username: string | null;
  severity: number | null;
  metadata: Record<string, unknown> | null;
};

export type EvidenceInsert = typeof siemEvidenceEvents.$inferInsert;

/** Pure: map a joined event row into a self-contained evidence insert row. */
export function buildEvidenceSnapshot(findingId: number, row: JoinedEventRow): EvidenceInsert {
  return {
    findingId,
    originalEventId: row.id,
    eventTime: row.eventTime,
    receivedAt: row.receivedAt,
    sourceIp: row.sourceIp,
    hostname: row.hostname,
    deviceId: row.deviceId,
    sourceId: row.sourceId,
    message: row.message,
    rawMessage: row.rawMessage,
    category: row.category,
    normalizedType: row.normalizedType,
    action: row.action,
    outcome: row.outcome,
    srcIp: row.srcIp,
    dstIp: row.dstIp,
    username: row.username,
    severity: row.severity,
    metadata: row.metadata ?? {},
  };
}

/**
 * Archive the referenced events of a finding into siem_evidence_events and mark
 * the finding evidenceArchived=true. Idempotent: skips events already archived
 * for this finding. Returns the number of evidence rows inserted.
 */
export async function archiveFindingEvidence(finding: { id: number; sampleEventIds: number[] }): Promise<number> {
  if (finding.sampleEventIds.length === 0) {
    await db.update(siemFindings).set({ evidenceArchived: true, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
    return 0;
  }

  const existing = await db
    .select({ originalEventId: siemEvidenceEvents.originalEventId })
    .from(siemEvidenceEvents)
    .where(eq(siemEvidenceEvents.findingId, finding.id));
  const already = new Set(existing.map((row) => row.originalEventId));
  const missing = finding.sampleEventIds.filter((id) => !already.has(id));

  let inserted = 0;
  if (missing.length > 0) {
    const rows = await db
      .select({
        id: syslogEvents.id,
        eventTime: syslogEvents.eventTime,
        receivedAt: syslogEvents.receivedAt,
        sourceIp: syslogEvents.sourceIp,
        hostname: syslogEvents.hostname,
        deviceId: syslogEvents.deviceId,
        sourceId: syslogEvents.sourceId,
        message: syslogEvents.message,
        rawMessage: syslogEventsRaw.rawMessage,
        category: syslogEvents.category,
        normalizedType: syslogEvents.normalizedType,
        action: syslogEvents.action,
        outcome: syslogEvents.outcome,
        srcIp: syslogEvents.srcIp,
        dstIp: syslogEvents.dstIp,
        username: syslogEvents.username,
        severity: syslogEvents.severity,
        metadata: syslogEvents.metadata,
      })
      .from(syslogEvents)
      .leftJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
      .where(inArray(syslogEvents.id, missing));

    if (rows.length > 0) {
      const snapshots = rows.map((row) => buildEvidenceSnapshot(finding.id, row as JoinedEventRow));
      await db.insert(siemEvidenceEvents).values(snapshots);
      inserted = snapshots.length;
    }
  }

  await db.update(siemFindings).set({ evidenceArchived: true, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
  return inserted;
}

export type FindingEvidenceSample = {
  id: number;
  receivedAt: Date;
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  username: string | null;
  srcIp: string | null;
  dstIp: string | null;
  message: string;
  rawMessage: string | null;
};

/**
 * Read a finding's evidence events. If archived, read from siem_evidence_events;
 * otherwise read the still-hot syslog_events joined with raw. Returns at most
 * `limit` rows. `siteId` restricts the hot path to the active site (evidence
 * rows are already finding-scoped).
 */
export async function getFindingEvidence(
  finding: { id: number; evidenceArchived: boolean; sampleEventIds: number[] },
  options: { limit: number; siteId: number },
): Promise<FindingEvidenceSample[]> {
  const ids = finding.sampleEventIds.slice(0, options.limit);

  if (finding.evidenceArchived) {
    const rows = await db
      .select({
        id: siemEvidenceEvents.originalEventId,
        receivedAt: siemEvidenceEvents.receivedAt,
        category: siemEvidenceEvents.category,
        normalizedType: siemEvidenceEvents.normalizedType,
        action: siemEvidenceEvents.action,
        outcome: siemEvidenceEvents.outcome,
        username: siemEvidenceEvents.username,
        srcIp: siemEvidenceEvents.srcIp,
        dstIp: siemEvidenceEvents.dstIp,
        message: siemEvidenceEvents.message,
        rawMessage: siemEvidenceEvents.rawMessage,
      })
      .from(siemEvidenceEvents)
      .where(eq(siemEvidenceEvents.findingId, finding.id))
      .limit(options.limit);
    return rows;
  }

  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: syslogEvents.id,
      receivedAt: syslogEvents.receivedAt,
      category: syslogEvents.category,
      normalizedType: syslogEvents.normalizedType,
      action: syslogEvents.action,
      outcome: syslogEvents.outcome,
      username: syslogEvents.username,
      srcIp: syslogEvents.srcIp,
      dstIp: syslogEvents.dstIp,
      message: syslogEvents.message,
      rawMessage: syslogEventsRaw.rawMessage,
    })
    .from(syslogEvents)
    .leftJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
    .where(and(eq(syslogEvents.siteId, options.siteId), inArray(syslogEvents.id, ids)));
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/siem/evidence.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the DB helpers type-check**

Run: `npm run lint`
Expected: PASS (no errors in `lib/siem/evidence.ts`).

- [ ] **Step 6: Commit**

```bash
git add lib/siem/evidence.ts lib/siem/evidence.test.ts
git commit -m "feat(siem): add evidence snapshot builder and finding evidence reader"
```

---

## Task 5: Rewrite the retention worker cleanup into 3 phases

**Files:**
- Modify: `lib/siem/retention.ts`

Rewrites `runSiemRetentionCleanup` to: (A) archive evidence for findings whose events are expiring, (B) pre-create upcoming partitions + drop fully-expired partitions, (C) batched per-source delete + orphan-raw delete. Verified by build (no live DB in tests). The pure helpers it uses are already tested in Tasks 2–3.

- [ ] **Step 1: Update imports at the top of `lib/siem/retention.ts`**

Replace the existing import lines (lines 1–3) with:

```ts
import { db } from "../../db";
import { siemAlerts, siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "../../db/schema";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { archiveFindingEvidence } from "./evidence";
import { partitionsForWindow, isPartitionFullyExpired, weekRange, partitionName } from "./partitioning";
```

(Note: `siemSettings` import is dropped here and re-added in the cleanup function via a local query; keep it if other code in the file uses it — search the file, and if `siemSettings` is referenced elsewhere, include it in the import list above.)

- [ ] **Step 2: Add the `SiemRetentionCleanupResult` fields for partitions**

Find the `export type SiemRetentionCleanupResult = {` block and replace it with:

```ts
export type SiemRetentionCleanupResult = {
  rawEventsDeleted: number;
  eventsDeleted: number;
  findingsDeleted: number;
  alertsDeleted: number;
  evidenceArchivedFindings: number;
  partitionsCreated: number;
  partitionsDropped: number;
};
```

- [ ] **Step 3: Add partition maintenance helpers to `lib/siem/retention.ts`**

Insert these two async functions immediately BEFORE `export async function runSiemRetentionCleanup`:

```ts
const PARTITIONED_TABLES = ["syslog_events", "syslog_events_raw"] as const;

/** Idempotently create weekly partitions covering recent + upcoming weeks. */
async function ensurePartitions(now: Date): Promise<number> {
  let created = 0;
  const weeks = partitionsForWindow(now, 1, 2); // last week + this week + 2 ahead
  for (const base of PARTITIONED_TABLES) {
    for (const week of weeks) {
      const name = partitionName(base, week.start);
      const startIso = week.start.toISOString();
      const endIso = week.end.toISOString();
      // CREATE TABLE IF NOT EXISTS ... PARTITION OF is idempotent.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(name)}
        PARTITION OF ${sql.identifier(base)}
        FOR VALUES FROM (${startIso}) TO (${endIso})
      `);
      created++;
    }
  }
  return created;
}

/** Drop partitions whose entire range is older than the most-lenient cutoff. */
async function dropExpiredPartitions(base: string, cutoff: Date, now: Date): Promise<number> {
  // List existing partitions of `base` from pg_inherits.
  const rows = await db.execute<{ child: string }>(sql`
    SELECT c.relname AS child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = ${base}
  `);
  const partitions = (rows.rows ?? rows) as Array<{ child: string }>;
  let dropped = 0;
  // Look back up to 520 weeks (~10y) to find candidate week ranges by name.
  const candidates = partitionsForWindow(now, 520, 0);
  const byName = new Map(candidates.map((week) => [partitionName(base, week.start), week]));
  for (const partition of partitions) {
    const week = byName.get(partition.child);
    if (!week) continue; // unknown/legacy partition name → never auto-drop
    if (isPartitionFullyExpired(week, cutoff)) {
      await db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(partition.child)}`);
      dropped++;
    }
  }
  return dropped;
}
```

- [ ] **Step 4: Replace the body of `runSiemRetentionCleanup`**

Replace the ENTIRE existing `export async function runSiemRetentionCleanup(...) { ... }` with:

```ts
export async function runSiemRetentionCleanup(options: { now?: Date; batchSize?: number } = {}): Promise<SiemRetentionCleanupResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(Math.floor(options.batchSize ?? 1000), 10000));

  const [settings] = await db.execute<{
    raw_retention_days: number | null;
    event_retention_days: number | null;
    finding_retention_days: number | null;
    alert_retention_days: number | null;
  }>(sql`
    SELECT raw_retention_days, event_retention_days, finding_retention_days, alert_retention_days
    FROM siem_settings LIMIT 1
  `).then((res) => (res.rows ?? res) as Array<{
    raw_retention_days: number | null;
    event_retention_days: number | null;
    finding_retention_days: number | null;
    alert_retention_days: number | null;
  }>);

  const globalEventDays = normalizeRetentionDays(settings?.event_retention_days, DEFAULT_SIEM_RETENTION_DAYS.events);
  const globalRawDays = normalizeRetentionDays(settings?.raw_retention_days, DEFAULT_SIEM_RETENTION_DAYS.raw);
  const globalFindingDays = normalizeRetentionDays(settings?.finding_retention_days, DEFAULT_SIEM_RETENTION_DAYS.findings);
  const globalAlertDays = normalizeRetentionDays(settings?.alert_retention_days, DEFAULT_SIEM_RETENTION_DAYS.alerts);

  const eventCutoff = cutoff(now, globalEventDays);
  const rawCutoff = cutoff(now, globalRawDays);
  const findingCutoff = cutoff(now, globalFindingDays);
  const alertCutoff = cutoff(now, globalAlertDays);

  // Load source overrides (only the column needed for the lenient cutoff + per-source delete).
  const sources = await db
    .select({ id: syslogSources.id, eventRetentionDays: syslogSources.eventRetentionDays })
    .from(syslogSources);

  // ----- PHASE A: archive finding evidence before any deletion -----
  // Archive non-Resolved findings that still reference events but are not yet archived.
  // We archive eagerly (any unarchived finding with events) so a later partition drop
  // can never destroy referenced events.
  const unarchived = await db
    .select({ id: siemFindings.id, sampleEventIds: siemFindings.sampleEventIds })
    .from(siemFindings)
    .where(and(eq(siemFindings.evidenceArchived, false), ne(siemFindings.status, "Resolved")))
    .limit(batchSize);

  let evidenceArchivedFindings = 0;
  for (const finding of unarchived) {
    await archiveFindingEvidence(finding);
    evidenceArchivedFindings++;
  }

  // ----- PHASE B: partition maintenance (create upcoming, drop fully-expired) -----
  const partitionsCreated = await ensurePartitions(now);
  const lenientCutoff = mostLenientEventCutoff(sources, globalEventDays, now);
  let partitionsDropped = 0;
  partitionsDropped += await dropExpiredPartitions("syslog_events", lenientCutoff, now);
  // raw partitions follow the raw cutoff but never drop newer than the event lenient cutoff,
  // so referenced raws joined to live events are never lost.
  const lenientRawCutoff = new Date(Math.min(rawCutoff.getTime(), lenientCutoff.getTime()));
  partitionsDropped += await dropExpiredPartitions("syslog_events_raw", lenientRawCutoff, now);

  // ----- PHASE C: precise per-source delete inside still-live partitions -----
  let eventsDeleted = 0;
  for (const source of sources) {
    const sourceDays = resolveSourceCutoffDays(source.eventRetentionDays, globalEventDays);
    // Sources at/above the global default are fully handled by partition drops.
    if (sourceDays >= globalEventDays) continue;
    const sourceCutoff = cutoff(now, sourceDays);
    // Loop batched deletes until drained.
    // Skip events that belong to an unresolved-but-already-archived finding? Not needed:
    // evidence is self-contained, so deleting the hot event is safe post-archive.
    // We still avoid deleting events newer than the source cutoff.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const victims = await db
        .select({ id: syslogEvents.id })
        .from(syslogEvents)
        .where(and(eq(syslogEvents.sourceId, source.id), lt(syslogEvents.receivedAt, sourceCutoff)))
        .limit(batchSize);
      if (victims.length === 0) break;
      const ids = victims.map((row) => row.id);
      const deleted = await db.delete(syslogEvents).where(inArray(syslogEvents.id, ids)).returning({ id: syslogEvents.id });
      eventsDeleted += deleted.length;
      if (victims.length < batchSize) break;
    }
  }

  // Global event delete for events with NO source mapping (sourceId IS NULL) past global cutoff,
  // covering rows inside still-live partitions.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const victims = await db
      .select({ id: syslogEvents.id })
      .from(syslogEvents)
      .where(and(sql`${syslogEvents.sourceId} is null`, lt(syslogEvents.receivedAt, eventCutoff)))
      .limit(batchSize);
    if (victims.length === 0) break;
    const ids = victims.map((row) => row.id);
    const deleted = await db.delete(syslogEvents).where(inArray(syslogEvents.id, ids)).returning({ id: syslogEvents.id });
    eventsDeleted += deleted.length;
    if (victims.length < batchSize) break;
  }

  // Orphan raw events (no surviving event) older than the raw cutoff, inside live partitions.
  const deletedRawEvents = await db.delete(syslogEventsRaw)
    .where(and(
      lt(syslogEventsRaw.receivedAt, rawCutoff),
      sql`not exists (select 1 from ${syslogEvents} where ${syslogEvents.rawEventId} = ${syslogEventsRaw.id})`,
    ))
    .returning({ id: syslogEventsRaw.id });

  // ----- Findings & alerts own expiry (never driven by the log stream) -----
  const oldAlerts = await db.delete(siemAlerts)
    .where(lt(siemAlerts.createdAt, alertCutoff))
    .returning({ id: siemAlerts.id });

  const staleFindings = await db
    .select({ id: siemFindings.id })
    .from(siemFindings)
    .where(and(eq(siemFindings.status, "Resolved"), lt(siemFindings.lastSeenAt, findingCutoff)))
    .limit(batchSize);
  const staleFindingIds = staleFindings.map((finding) => finding.id);

  let findingAlertsDeleted = 0;
  let findingsDeleted = 0;
  if (staleFindingIds.length > 0) {
    // Evidence rows FK to findings with no cascade; delete them first.
    await db.delete(siemEvidenceEvents).where(inArray(siemEvidenceEvents.findingId, staleFindingIds));
    const alertsForFindings = await db.delete(siemAlerts)
      .where(inArray(siemAlerts.findingId, staleFindingIds))
      .returning({ id: siemAlerts.id });
    const deletedFindings = await db.delete(siemFindings)
      .where(inArray(siemFindings.id, staleFindingIds))
      .returning({ id: siemFindings.id });
    findingAlertsDeleted = alertsForFindings.length;
    findingsDeleted = deletedFindings.length;
  }

  return {
    rawEventsDeleted: deletedRawEvents.length,
    eventsDeleted,
    findingsDeleted,
    alertsDeleted: oldAlerts.length + findingAlertsDeleted,
    evidenceArchivedFindings,
    partitionsCreated,
    partitionsDropped,
  };
}
```

- [ ] **Step 4b: Add the `siemEvidenceEvents` import**

The cleanup now deletes from `siemEvidenceEvents`. Update the schema import line (from Step 1) to include it:

```ts
import { siemAlerts, siemEvidenceEvents, siemFindings, syslogEvents, syslogEventsRaw, syslogSources } from "../../db/schema";
```

- [ ] **Step 5: Update the worker log line for the new result fields**

Open `scripts/siem-retention-worker.ts`. Replace the `if (total > 0) { ... }` block with:

```ts
    const total = result.rawEventsDeleted + result.eventsDeleted + result.findingsDeleted + result.alertsDeleted + result.partitionsDropped;
    if (total > 0 || result.partitionsCreated > 0 || result.evidenceArchivedFindings > 0) {
      console.log(
        `SIEM retention: ${result.rawEventsDeleted} raw, ${result.eventsDeleted} events, ${result.findingsDeleted} findings, ${result.alertsDeleted} alerts deleted; ` +
        `${result.evidenceArchivedFindings} findings archived; partitions +${result.partitionsCreated}/-${result.partitionsDropped}`,
      );
    }
```

(Delete the old `const total = ...` line above the original `if` if present, to avoid a duplicate declaration.)

- [ ] **Step 6: Verify the whole project still builds and unit tests pass**

Run: `npm run lint`
Expected: PASS.

Run: `npm run test`
Expected: PASS (all pure-function tests green; no test imports a live DB).

- [ ] **Step 7: Commit**

```bash
git add lib/siem/retention.ts scripts/siem-retention-worker.ts
git commit -m "feat(siem): rewrite retention cleanup into archive/drop/per-source phases"
```

---

## Task 6: One-time partition migration script

**Files:**
- Create: `scripts/siem-partition-migrate.ts`

Converts the two populated log tables into RANGE-partitioned tables. Because Postgres cannot `ALTER` a populated plain table into a partitioned one, this creates a partitioned twin, copies data into per-week partitions, then swaps names inside one transaction. It is idempotent: if the parent is already partitioned, it exits cleanly.

> **Operator note (put in PR description):** Run with `npx tsx scripts/siem-partition-migrate.ts` AFTER `npm run db:migrate` (Task 1) and a database backup. The retention worker must be stopped during this run.

- [ ] **Step 1: Write `scripts/siem-partition-migrate.ts`**

```ts
#!/usr/bin/env tsx
import dotenv from "dotenv";
import { Pool } from "pg";
import { buildDatabaseUrl } from "../lib/database-url";
import { partitionsForWindow, partitionName } from "../lib/siem/partitioning";

dotenv.config();

const pool = new Pool({ connectionString: buildDatabaseUrl() });

type TableSpec = {
  base: string;
  // Full column DDL for the new partitioned table, in original order.
  // received_at MUST be part of the primary key for RANGE partitioning.
  createSql: (name: string) => string;
};

async function isPartitioned(base: string): Promise<boolean> {
  const res = await pool.query<{ partstrat: string | null }>(
    `SELECT p.partstrat
     FROM pg_class c
     LEFT JOIN pg_partitioned_table p ON p.partrelid = c.oid
     WHERE c.relname = $1`,
    [base],
  );
  return Boolean(res.rows[0]?.partstrat);
}

async function dataRange(base: string): Promise<{ min: Date; max: Date } | null> {
  const res = await pool.query<{ min: Date | null; max: Date | null }>(
    `SELECT MIN(received_at) AS min, MAX(received_at) AS max FROM "${base}"`,
  );
  const row = res.rows[0];
  if (!row?.min || !row?.max) return null;
  return { min: new Date(row.min), max: new Date(row.max) };
}

const SPECS: TableSpec[] = [
  {
    base: "syslog_events_raw",
    createSql: (name) => `
      CREATE TABLE "${name}" (
        "id" serial NOT NULL,
        "received_at" timestamp NOT NULL DEFAULT now(),
        "source_ip" text NOT NULL,
        "source_port" integer NOT NULL,
        "transport" "syslog_transport" NOT NULL DEFAULT 'udp',
        "raw_message" text NOT NULL,
        "raw_size" integer NOT NULL,
        "ingest_status" "syslog_ingest_status" NOT NULL DEFAULT 'received',
        "parse_error" text,
        "created_at" timestamp DEFAULT now(),
        PRIMARY KEY ("id", "received_at")
      ) PARTITION BY RANGE ("received_at")`,
  },
  {
    base: "syslog_events",
    createSql: (name) => `
      CREATE TABLE "${name}" (
        "id" serial NOT NULL,
        "raw_event_id" integer NOT NULL,
        "event_time" timestamp,
        "received_at" timestamp NOT NULL,
        "source_ip" text NOT NULL,
        "hostname" text,
        "facility" integer,
        "severity" integer,
        "priority" integer,
        "app_name" text,
        "program" text,
        "process_id" text,
        "message" text NOT NULL,
        "site_id" integer,
        "device_id" integer,
        "source_id" integer,
        "vendor" "syslog_vendor",
        "parser" text NOT NULL,
        "category" text,
        "normalized_type" text,
        "action" text,
        "outcome" text,
        "src_ip" text,
        "src_port" integer,
        "dst_ip" text,
        "dst_port" integer,
        "username" text,
        "interface_name" text,
        "protocol" text,
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now(),
        PRIMARY KEY ("id", "received_at")
      ) PARTITION BY RANGE ("received_at")`,
  },
];

const INDEXES: Record<string, string[]> = {
  syslog_events_raw: [
    `CREATE INDEX IF NOT EXISTS "syslog_events_raw_received_at_idx" ON "syslog_events_raw" ("received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_raw_source_received_idx" ON "syslog_events_raw" ("source_ip", "received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_raw_status_received_idx" ON "syslog_events_raw" ("ingest_status", "received_at")`,
  ],
  syslog_events: [
    `CREATE INDEX IF NOT EXISTS "syslog_events_received_at_idx" ON "syslog_events" ("received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_site_received_idx" ON "syslog_events" ("site_id", "received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_device_received_idx" ON "syslog_events" ("device_id", "received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_source_received_idx" ON "syslog_events" ("source_ip", "received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_normalized_received_idx" ON "syslog_events" ("normalized_type", "received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_severity_received_idx" ON "syslog_events" ("severity", "received_at")`,
    `CREATE INDEX IF NOT EXISTS "syslog_events_category_received_idx" ON "syslog_events" ("category", "received_at")`,
  ],
};

async function migrateTable(spec: TableSpec): Promise<void> {
  if (await isPartitioned(spec.base)) {
    console.log(`✓ ${spec.base} already partitioned — skipping`);
    return;
  }

  const range = await dataRange(spec.base);
  const newName = `${spec.base}_partitioned`;
  const oldName = `${spec.base}_old`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create the partitioned twin.
    await client.query(spec.createSql(newName));

    // 2. Create weekly partitions covering existing data (plus 2 weeks ahead).
    const now = new Date();
    const weeks = range
      ? partitionsForWindow(range.max, weeksBetween(range.min, range.max) + 1, 2)
      : partitionsForWindow(now, 1, 2);
    for (const week of weeks) {
      const partName = partitionName(newName, week.start);
      await client.query(
        `CREATE TABLE IF NOT EXISTS "${partName}" PARTITION OF "${newName}"
         FOR VALUES FROM ($1) TO ($2)`,
        [week.start.toISOString(), week.end.toISOString()],
      );
    }

    // 3. Copy data.
    await client.query(`INSERT INTO "${newName}" SELECT * FROM "${spec.base}"`);

    // 4. Reset the id sequence so new inserts don't collide.
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "${newName}"), 1))`,
      [newName],
    );

    // 5. Drop the raw_event_id FK on syslog_events (cannot reference a partitioned table).
    if (spec.base === "syslog_events") {
      await client.query(
        `ALTER TABLE "${spec.base}" DROP CONSTRAINT IF EXISTS "syslog_events_raw_event_id_syslog_events_raw_id_fk"`,
      );
    }

    // 6. Swap names.
    await client.query(`ALTER TABLE "${spec.base}" RENAME TO "${oldName}"`);
    await client.query(`ALTER TABLE "${newName}" RENAME TO "${spec.base}"`);

    // 7. Indexes on the new parent (propagate to partitions).
    for (const indexSql of INDEXES[spec.base] ?? []) {
      await client.query(indexSql);
    }

    await client.query("COMMIT");
    console.log(`✓ ${spec.base} converted to partitioned table (old data in "${oldName}")`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function weeksBetween(a: Date, b: Date): number {
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / (7 * 24 * 60 * 60 * 1000)));
}

async function main() {
  console.log("🔄 SIEM partition migration starting...");
  // Order matters: events references raw via app logic; convert raw first.
  await migrateTable(SPECS[0]);
  await migrateTable(SPECS[1]);
  console.log("✅ Partition migration complete. Verify, then DROP the *_old tables after a backup.");
  await pool.end();
}

main().catch(async (error) => {
  console.error("❌ Partition migration failed:", error);
  await pool.end();
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script type-checks**

Run: `npm run lint`
Expected: PASS (no errors in `scripts/siem-partition-migrate.ts`).

- [ ] **Step 3: Commit**

```bash
git add scripts/siem-partition-migrate.ts
git commit -m "feat(siem): add one-time partition migration script for log tables"
```

---

## Task 7: Wire evidence reader into the AI analysis action

**Files:**
- Modify: `actions/siem-ai.ts`

Replace the inline `syslogEvents` query (which breaks once events are deleted) with `getFindingEvidence`, so archived findings still show their evidence.

- [ ] **Step 1: Update imports in `actions/siem-ai.ts`**

Add this import near the other `@/lib/siem` imports:

```ts
import { getFindingEvidence } from "@/lib/siem/evidence";
```

- [ ] **Step 2: Replace the `eventRows` query block**

Find the block (around lines 69–86) that starts with `const sampleEventIds = finding.sampleEventIds.slice(...)` and ends with the `: [];` closing the `eventRows` ternary. Replace the WHOLE block with:

```ts
  const eventRows = await getFindingEvidence(
    { id: finding.id, evidenceArchived: finding.evidenceArchived, sampleEventIds: finding.sampleEventIds },
    { limit: settings.aiMaxSampleEvents, siteId: auth.activeSiteId },
  );
```

(The downstream `events: eventRows as SiemAiEventSample[]` line stays — `FindingEvidenceSample` is shape-compatible with the fields `buildSiemAiPrompt` reads: `receivedAt, category, normalizedType, action, outcome, username, srcIp, dstIp, message, rawMessage`.)

- [ ] **Step 3: Verify build**

Run: `npm run lint`
Expected: PASS. If TypeScript complains that `eventRows` is missing a field used by `SiemAiEventSample`, open `lib/siem/ai-analysis.ts`, find the `SiemAiEventSample` type, and confirm every field it requires exists on `FindingEvidenceSample` in `lib/siem/evidence.ts`. Add any missing field to both the `getFindingEvidence` select and `FindingEvidenceSample` (copying from `siemEvidenceEvents` / `syslogEvents`).

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add actions/siem-ai.ts
git commit -m "feat(siem): read finding evidence via archive-aware helper in AI action"
```

---

## Task 8: Per-source retention in the admin UI

**Files:**
- Modify: `actions/siem-sources.ts`
- Modify: `components/admin/siem-source-table.tsx`

Adds two optional numeric fields (raw + event retention days, empty = follow global) to the source edit modal, validates them, and persists them. Also surfaces the effective value in the table.

- [ ] **Step 1: Extend the Zod schema + select in `actions/siem-sources.ts`**

In `sourceUpdateSchema`, add two fields after `enabled`:

```ts
  enabled: z.coerce.boolean(),
  rawRetentionDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  eventRetentionDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
```

In `getSiemSources`, add the two columns to the `db.select({ ... })` for `sourceRows` (after `eventCount: syslogSources.eventCount,`):

```ts
      eventCount: syslogSources.eventCount,
      rawRetentionDays: syslogSources.rawRetentionDays,
      eventRetentionDays: syslogSources.eventRetentionDays,
```

In `updateSiemSource`, add the two fields to the `safeParse({ ... })` input (after `enabled: ...`):

```ts
    enabled: formData.get("enabled") === "true",
    rawRetentionDays: formData.get("rawRetentionDays") || null,
    eventRetentionDays: formData.get("eventRetentionDays") || null,
```

And add them to the `db.update(syslogSources).set({ ... })` payload (after `enabled: parsed.data.enabled,`):

```ts
    enabled: parsed.data.enabled,
    rawRetentionDays: parsed.data.rawRetentionDays ?? null,
    eventRetentionDays: parsed.data.eventRetentionDays ?? null,
```

- [ ] **Step 2: Verify the action type-checks**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Extend the `SiemSourceRow` type in `components/admin/siem-source-table.tsx`**

Add two fields to the `SiemSourceRow` type (after `eventCount: number;`):

```ts
  eventCount: number;
  rawRetentionDays: number | null;
  eventRetentionDays: number | null;
```

- [ ] **Step 4: Add retention inputs to the edit modal in `components/admin/siem-source-table.tsx`**

Inside `EditSourceModal`, in the `<div className="grid gap-4 md:grid-cols-2">`, add two more `<label>` blocks immediately after the `Enabled` label's closing `</label>`:

```tsx
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Raw retention (days)
              <input
                name="rawRetentionDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={source.rawRetentionDays ?? ""}
                placeholder="Follow global"
                className={`${fieldClass} w-full`}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Event retention (days)
              <input
                name="eventRetentionDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={source.eventRetentionDays ?? ""}
                placeholder="Follow global"
                className={`${fieldClass} w-full`}
              />
            </label>
```

- [ ] **Step 5: Show effective retention in the table**

In the table header row (`<DataTableHead>`), add a header cell after the `Events` header `<th>`:

```tsx
              <th className="px-5 py-3 text-right">Retention</th>
```

In the body row, add a matching cell after the `eventCount` `<td>` (the one ending `{source.eventCount.toLocaleString("id-ID")}</td>`):

```tsx
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-ops-muted">
                  {source.eventRetentionDays ? `${source.eventRetentionDays}d` : "Global"}
                </td>
```

Update the empty-state `colSpan` from `8` to `9`:

```tsx
              <DataTableEmpty colSpan={9} title={search || trustFilter ? "No SIEM sources match filters" : "No SIEM sources yet"} description="Unknown sources appear here after syslog packets arrive and unknown-source handling is enabled." />
```

- [ ] **Step 6: Verify build**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add actions/siem-sources.ts components/admin/siem-source-table.tsx
git commit -m "feat(siem): per-source retention overrides in sources admin UI"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — all pure-function tests green, including the new `partitioning.test.ts`, `evidence.test.ts`, and extended `retention.test.ts`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS — Next.js compiles all routes, server actions, and the schema with no type errors.

- [ ] **Step 4: Final commit (if any lint/format fixes were applied)**

```bash
git add -A
git commit -m "chore(siem): retention scale verification fixes" || echo "nothing to commit"
```

---

## Deployment Runbook (include in the PR description — NOT executed by the worker)

1. Back up the database.
2. `npm run db:migrate` — applies `0008` (additive: evidence table, source retention columns, finding flag).
3. Stop the retention worker (`siem:retention`) and the syslog receiver briefly.
4. `npx tsx scripts/siem-partition-migrate.ts` — converts `syslog_events` + `syslog_events_raw` to partitioned tables (idempotent; safe to re-run).
5. Verify ingest works: restart the syslog receiver, confirm new rows land (the script pre-created current + 2 future weekly partitions; the retention worker creates more on each run).
6. Restart the retention worker.
7. After a few days of confirmed-healthy operation, `DROP TABLE syslog_events_old, syslog_events_raw_old;`.

## Self-Review notes (already applied)

- **Spec coverage:** partitioning (Tasks 2, 5, 6), per-source retention (Tasks 3, 8), evidence preservation (Tasks 1, 4, 5), archive-aware reads (Task 7), findings never deleted by log stream (Task 5 Phase C keeps findings separate; only Resolved+expired findings are removed, after their evidence). ✅
- **Type consistency:** `resolveSourceCutoffDays`, `mostLenientEventCutoff`, `buildEvidenceSnapshot`, `getFindingEvidence`, `partitionName`, `weekRange`, `isPartitionFullyExpired`, `partitionsForWindow` are named identically wherever referenced. ✅
- **No placeholders:** every code step contains full code. ✅
