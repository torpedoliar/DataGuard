#!/usr/bin/env tsx
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-syslog-receiver.health.json";
const maxStalenessMs = Number(process.env.HEALTH_MAX_STALENESS_MS || 90_000);
const minSockets = Number(process.env.HEALTH_MIN_SOCKETS || 1);

type HealthStatus = {
  updatedAt: string;
  sockets: { transport: string; listening: boolean; address?: string }[];
  counters: { received: number; inserted: number; dropped: number; oversized: number; failed: number };
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

function checkSockets(status: HealthStatus) {
  const listening = status.sockets.filter((s) => s.listening).length;
  if (listening < minSockets) {
    fail(`only ${listening}/${minSockets} sockets listening`);
  }
}

function checkStaleness(status: HealthStatus) {
  const updatedAt = new Date(status.updatedAt).getTime();
  const now = Date.now();
  if (Number.isNaN(updatedAt)) {
    fail("invalid updatedAt timestamp");
  }
  if (now - updatedAt > maxStalenessMs) {
    fail(`no heartbeat for ${Math.round((now - updatedAt) / 1000)}s`);
  }
}

/** Verify DB is reachable and the current-week partition for syslog_events_raw exists. */
async function checkDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return; // skip DB check if no URL configured

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();

    // 1. Basic connectivity
    await client.query("SELECT 1");

    // 2. Check current-week partition exists for syslog_events_raw.
    //    The partition name follows the pattern syslog_events_raw_pYYYYMMDD
    //    where YYYYMMDD is the Monday of the current ISO week.
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
    const partitionName = `syslog_events_raw_p${suffix}`;

    const result = await client.query(
      "SELECT 1 FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace",
      [partitionName],
    );
    if (result.rowCount === 0) {
      fail(`current-week partition missing: ${partitionName} — new inserts will fail`);
    }

    // 3. Check the drop rate isn't too high (>50% drops in last heartbeat window is suspicious)
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
  checkSockets(status);
  checkStaleness(status);

  // Check high drop rate (more than 50% of received messages dropped)
  if (status.counters.received > 100 && status.counters.dropped / status.counters.received > 0.5) {
    console.warn(`WARNING: high drop rate ${status.counters.dropped}/${status.counters.received}`);
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
