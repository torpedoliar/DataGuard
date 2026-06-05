# SIEM Retention Per-Source + Scale to Tens of Millions — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming)

## Problem

SIEM ingests syslog into `syslog_events_raw` + `syslog_events`. At tens of millions
of rows, the current hourly batched-`DELETE` retention worker becomes slow and causes
table bloat (autovacuum pressure). We also need:

1. **Per-source retention** — each syslog source (sender IP/host) can define how many
   days its logs are kept; past that, logs auto-delete.
2. **Preserve SIEM findings AND their evidence logs** — log expiry must never destroy
   a finding nor the specific events that finding references.

## Goals

- Handle tens of millions of log rows with fast, low-bloat deletion.
- Per-source retention override, falling back to global defaults.
- Findings are never deleted by log expiry; their referenced events are preserved.

## Non-Goals (YAGNI)

- Object-storage / cold-archive tiering — evidence stays in Postgres.
- Partition compression.
- Per-source partitions (table explosion) — partition by time only.
- Per-device retention — retention lives at the syslog-source level.

## Architecture

Three layers, each with one job:

```
INGEST (hot)
  syslog_events_raw + syslog_events
  → PARTITIONED BY RANGE (received_at), weekly partitions (e.g. p_2026w23)
  → fast writes, fast bulk drop
        │ rule-engine creates finding → records sampleEventIds
        ▼
EVIDENCE (warm, permanent)
  siem_evidence_events (NEW, non-partitioned)
  → self-contained snapshot of each event a finding references
  → survives partition drops, lives as long as its finding
        ▲ retention worker copies BEFORE dropping
        │
RETENTION (worker, hourly)
  per source: cutoff = source.eventRetentionDays ?? global
  Phase A: archive expiring finding-evidence → evidence table
  Phase B: DROP partitions fully older than the most-lenient active cutoff (fast path)
  Phase C: precise batched DELETE per-source inside still-live partitions (slow path)
```

**Core tension — partition (global, time-based) vs per-source retention:** A weekly
partition can contain a 7-day source (already dead) and a 365-day source (still alive).
Resolution:

- A partition may be **DROPped** only if its entire range is older than
  `MAX(eventRetentionDays)` across all active sources + global default → fast path,
  majority of old volume.
- A short-retention source whose logs still sit inside a not-yet-droppable partition →
  **batched per-source DELETE** (precise path, far smaller volume).

## Schema Changes

### a) `syslog_sources` — per-source retention (nullable, null = global)

```ts
rawRetentionDays:   integer("raw_retention_days"),    // null → global
eventRetentionDays: integer("event_retention_days"),  // null → global
```

Only raw + event are per-source (that is the tens-of-millions volume). Finding & alert
retention stay global — they are few and cross-source.

### b) `siem_evidence_events` — evidence archive (NEW, non-partitioned)

Self-contained snapshot. NOT a FK to `syslog_events` (the original event will be
deleted). Copies the columns analysts and findings use, including `rawMessage` from
`syslog_events_raw`.

```ts
export const siemEvidenceEvents = pgTable("siem_evidence_events", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id).notNull(),
  originalEventId: integer("original_event_id").notNull(),  // old id, for tracing
  eventTime: timestamp("event_time"),
  receivedAt: timestamp("received_at").notNull(),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  deviceId: integer("device_id"),
  sourceId: integer("source_id"),
  message: text("message").notNull(),
  rawMessage: text("raw_message"),          // copied from syslog_events_raw
  normalizedType: text("normalized_type"),
  action: text("action"),
  outcome: text("outcome"),
  srcIp: text("src_ip"),
  dstIp: text("dst_ip"),
  username: text("username"),
  severity: integer("severity"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),  // full snapshot
  archivedAt: timestamp("archived_at").defaultNow(),
}, (table) => ({
  findingIdx: index("siem_evidence_events_finding_idx").on(table.findingId),
  originalIdx: index("siem_evidence_events_original_idx").on(table.originalEventId),
}));
```

### c) `siem_findings` — evidence-archived flag

```ts
evidenceArchived: boolean("evidence_archived").notNull().default(false),
```

`sampleEventIds` stays (pointers to hot events while they live). Once archived, finding
readers switch to reading `siem_evidence_events` via `evidenceArchived`.

### d) Partitioning constraints (Postgres)

- Partition key `received_at` must be part of the PRIMARY KEY → PK changes from `id` to
  `(id, received_at)` on both `syslog_events_raw` and `syslog_events`. `serial` stays.
- FK `syslog_events.raw_event_id → syslog_events_raw.id` cannot point at a partitioned
  table without including the partition column → **drop that FK constraint**; integrity
  enforced in application code (worker already follows this pattern).
- Existing populated tables cannot be `ALTER`ed into partitioned tables in place →
  migration must **create partitioned table + copy data + rename**. Custom migration
  script, NOT `drizzle-kit push`.

## Retention Worker (new flow)

`runSiemRetentionCleanup` rewritten as 3 ordered phases. Worker keeps its hourly cadence.

```
PHASE A — Archive evidence (before anything is deleted)
  find non-Resolved findings with evidenceArchived=false whose sampleEventIds point at
  events older than their source cutoff
  → JOIN syslog_events + syslog_events_raw, INSERT into siem_evidence_events
  → set finding.evidenceArchived=true
  Also archive Resolved findings not yet past findingRetentionDays (so evidence is not
  lost before the finding itself expires).

PHASE B — Drop partitions (fast path, majority of volume)
  globalMaxCutoff = now - MAX(eventRetentionDays across active sources + global)
  for each partition whose range is ENTIRELY < globalMaxCutoff:
    DROP TABLE partition   ← instant, no bloat, no vacuum
  (evidence already safe from Phase A)

PHASE C — Precise per-source DELETE (slow path, small volume)
  for each source with a cutoff stricter than the live partitions:
    batched DELETE syslog_events
      WHERE source_id = ? AND received_at < sourceCutoff
        AND id NOT IN (events just archived / still referenced by active findings)
      LIMIT batchSize, loop until drained, pause between batches
  then orphan raw (no event) → batched DELETE as today
```

**Partition creation:** worker also **pre-creates next week's partition** on each run
(standard maintenance pattern) so ingest never hits "no partition for row".
Idempotent (`CREATE TABLE IF NOT EXISTS ... PARTITION OF`).

**Safety:** Phase B only drops if Phase A succeeded (ordering preserved). If archiving
fails, partitions are not dropped — data intact, retried next hour. Findings & alerts
are never deleted by the log stream; they expire only via their own
`findingRetentionDays` (Resolved + past cutoff), and only after evidence is safe.

## UI / Admin

### a) Per-source retention on Sources page (`app/(dashboard)/admin/siem/sources`)

- Each source row gets "Raw retention (days)" + "Event retention (days)" fields; empty =
  "Follow global". Server action updates `syslog_sources`.
- Validation: integer ≥ 1 or empty.

### b) Global settings

`siemSettings.rawRetentionDays` etc. already exist. Add explanatory label that these are
the defaults used when a source sets none. UI text only, no schema change.

### c) Finding evidence reading

- `evidenceArchived=false` → read from `syslog_events` (hot) as today.
- `evidenceArchived=true` → read from `siem_evidence_events`.
- One helper `getFindingEvidence(finding)` hides the branch; all readers
  (finding detail, `human-analysis`, AI analysis) use it.

## Testing

- **retention.test.ts** (extend): per-source cutoff honored; finding-evidence archived
  before delete; clean partitions dropped; partitions with live sources not dropped;
  findings never lost by the log stream.
- **partition-maintenance.test.ts** (new): idempotent pre-create; correct partition name
  from a date.
- **evidence.test.ts** (new): self-contained snapshot (rawMessage copied); reader
  switches source per flag.
- Follow existing `vitest` patterns.

## Migration Plan

1. Add `siem_evidence_events` table + `syslog_sources` retention columns +
   `siem_findings.evidence_archived` (additive, `drizzle-kit`).
2. Custom migration script: rebuild `syslog_events_raw` and `syslog_events` as
   partitioned tables (create partitioned + copy + rename + composite PK + drop raw→event
   FK + create initial partitions covering existing data range).
3. Deploy worker rewrite.
