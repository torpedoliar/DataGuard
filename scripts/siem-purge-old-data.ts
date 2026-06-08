#!/usr/bin/env tsx
import dotenv from "dotenv";
import { Pool } from "pg";
import { buildDatabaseUrl } from "../lib/database-url";

dotenv.config();

const RETENTION_DAYS = Number(process.env.PURGE_RETENTION_DAYS ?? 1);
const BATCH_SIZE = Number(process.env.PURGE_BATCH_SIZE ?? 5000);

const pool = new Pool({ connectionString: buildDatabaseUrl() });

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

async function tableSizeMb(base: string): Promise<number> {
  const res = await pool.query<{ size_mb: string }>(
    `SELECT pg_size_pretty(pg_total_relation_size($1::regclass)) AS size_mb`, [base],
  );
  return parseFloat(res.rows[0]?.size_mb ?? "0");
}

async function countOld(base: string, cutoff: Date): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM "${base}" WHERE received_at < $1`,
    [cutoff],
  );
  return parseInt(res.rows[0].count, 10);
}

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  console.log(`Cutoff: ${cutoff.toISOString()} (${RETENTION_DAYS} day(s) ago)`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  // Show current sizes
  const eventsSize = await tableSizeMb("syslog_events");
  const rawSize = await tableSizeMb("syslog_events_raw");
  console.log(`\nCurrent sizes: syslog_events ~${eventsSize} MB, syslog_events_raw ~${rawSize} MB`);

  // Estimate count of old rows
  const oldEvents = await countOld("syslog_events", cutoff);
  const oldRaw = await countOld("syslog_events_raw", cutoff);
  console.log(`Rows to delete: events=${oldEvents.toLocaleString("id-ID")}, raw=${oldRaw.toLocaleString("id-ID")}`);

  if (oldEvents === 0 && oldRaw === 0) {
    console.log("Nothing to delete.");
    await pool.end();
    return;
  }

  const partitioned = await isPartitioned("syslog_events");

  // --- syslog_events ---
  if (partitioned) {
    // Partitioned: DROP whole old partitions (instant). Fallback DELETE for partial weeks.
    console.log("\n⚠ Tables are partitioned — DROP old partitions is fastest.");
    console.log("  Run instead: npx tsx scripts/siem-partition-migrate.ts checks, then");
    console.log("  the retention worker handles partition drops automatically.");
    console.log("  Proceeding with batched DELETE inside live partitions...");
  }

  console.log("\n--- Phase 1: Delete old syslog_events ---");
  let eventsDeleted = 0;
  let done = false;
  while (!done) {
    const res = await pool.query<{ id: number }>(
      `DELETE FROM syslog_events WHERE id IN (SELECT id FROM syslog_events WHERE received_at < $1 LIMIT $2) RETURNING id`,
      [cutoff, BATCH_SIZE],
    );
    const n = res.rowCount ?? 0;
    eventsDeleted += n;
    if (n < BATCH_SIZE) done = true;
    console.log(`  ${eventsDeleted.toLocaleString("id-ID")} events deleted...`);
  }
  console.log(`  ✓ events: ${eventsDeleted.toLocaleString("id-ID")} deleted`);

  // --- syslog_events_raw (orphan only) ---
  console.log("\n--- Phase 2: Delete orphan syslog_events_raw ---");
  const rawRes = await pool.query(
    `WITH orphan AS (
       DELETE FROM syslog_events_raw
       WHERE received_at < $1
         AND NOT EXISTS (SELECT 1 FROM syslog_events WHERE syslog_events.raw_event_id = syslog_events_raw.id)
       RETURNING id
     ) SELECT COUNT(*) AS deleted FROM orphan`,
    [cutoff],
  );
  const rawsDeleted = parseInt(rawRes.rows[0].deleted, 10);
  console.log(`  ✓ raw: ${rawsDeleted.toLocaleString("id-ID")} deleted`);

  // Final sizes
  const finalEventsSize = await tableSizeMb("syslog_events");
  const finalRawSize = await tableSizeMb("syslog_events_raw");
  const freedMb = (eventsSize + rawSize - finalEventsSize - finalRawSize);

  console.log(`\n--- Done ---`);
  console.log(`Events: ${eventsDeleted.toLocaleString("id-ID")} deleted`);
  console.log(`Raw:    ${rawsDeleted.toLocaleString("id-ID")} deleted`);
  console.log(`Freed:  ~${freedMb > 0 ? freedMb : 0} MB`);
  console.log(`After:  syslog_events ~${finalEventsSize} MB, syslog_events_raw ~${finalRawSize} MB`);

  await pool.end();
}

main().catch(async (error) => {
  console.error("Purge failed:", error);
  await pool.end();
  process.exit(1);
});
