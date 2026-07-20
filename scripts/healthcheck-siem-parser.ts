#!/usr/bin/env tsx
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-siem-parser.health.json";
const maxStalenessMs = Number(process.env.HEALTH_MAX_STALENESS_MS || 120_000);

type HealthStatus = {
  updatedAt: string;
  lastParsedAt?: string;
  lastError?: string;
  parsedTotal: number;
};

function fail(message: string): never {
  console.error(`UNHEALTHY: ${message}`);
  process.exit(1);
}

function loadStatus(): HealthStatus | null {
  try {
    const raw = fs.readFileSync(healthFile, "utf8");
    return JSON.parse(raw) as HealthStatus;
  } catch {
    return null;
  }
}

/** Verify DB is reachable and the current-week partition for syslog_events exists. */
async function checkDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();

    // 1. Basic connectivity
    await client.query("SELECT 1");

    // 2. Check current-week partition exists for syslog_events (parser writes here).
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dow = new Date(utcMidnight).getUTCDay();
    const daysSinceMonday = (dow + 6) % 7;
    const mondayMs = utcMidnight - daysSinceMonday * 86400000;
    const monday = new Date(mondayMs);
    const suffix =
      monday.getUTCFullYear().toString().padStart(4, "0") +
      (monday.getUTCMonth() + 1).toString().padStart(2, "0") +
      monday.getUTCDate().toString().padStart(2, "0");
    const partitionName = `syslog_events_p${suffix}`;

    const result = await client.query(
      "SELECT 1 FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace",
      [partitionName],
    );
    if (result.rowCount === 0) {
      fail(`current-week partition missing: ${partitionName} — parser inserts will fail`);
    }

    // 3. Check if there's a backlog of "received" raw events stuck for too long.
    //    If >10k rows have been sitting unprocessed for 10+ minutes, something is wrong.
    const backlogResult = await client.query(
      `SELECT COUNT(*) AS cnt FROM syslog_events_raw
       WHERE ingest_status = 'received' AND received_at < now() - interval '10 minutes'`,
    );
    const backlogCount = Number(backlogResult.rows[0]?.cnt ?? 0);
    if (backlogCount > 10000) {
      console.warn(`WARNING: parser backlog of ${backlogCount} raw events older than 10min`);
    }
  } catch (error) {
    if ((error as { message?: string })?.message?.startsWith("UNHEALTHY")) throw error;
    fail(`database check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const status = loadStatus();
  if (!status) {
    fail(`health file not found: ${healthFile}`);
  }

  if (status.lastError) {
    // Allow transient errors; only fail if the worker itself is stale.
    console.warn(`last error: ${status.lastError}`);
  }

  const updatedAt = new Date(status.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) {
    fail("invalid updatedAt timestamp");
  }

  const now = Date.now();
  if (now - updatedAt > maxStalenessMs) {
    fail(`no heartbeat for ${Math.round((now - updatedAt) / 1000)}s`);
  }

  await checkDatabase();
  console.log("HEALTHY");
  process.exit(0);
}

main().catch((error) => {
  if ((error as { message?: string })?.message?.startsWith("UNHEALTHY")) process.exit(1);
  console.error(`UNHEALTHY: unexpected error: ${error}`);
  process.exit(1);
});
