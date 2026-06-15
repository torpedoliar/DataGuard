#!/usr/bin/env tsx
/**
 * @deprecated Use `drizzle/0016_si_partitioned.sql` instead. This script
 * remains for emergency manual use only. Idempotent drizzle migration is
 * the supported path; both can coexist (manual script is a no-op if the
 * table is already partitioned).
 */
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
