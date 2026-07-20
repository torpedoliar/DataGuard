#!/usr/bin/env tsx
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const healthFile = process.env.HEALTH_FILE_PATH || "/tmp/dccheck-siem-alerts.health.json";
const maxStalenessMs = Number(process.env.HEALTH_MAX_STALENESS_MS || 120_000);

type HealthStatus = {
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
  queuedTotal: number;
  sentTotal: number;
  failedTotal: number;
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

/** Verify DB is reachable and check for stuck pending alerts. */
async function checkDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();

    // 1. Basic connectivity
    await client.query("SELECT 1");

    // 2. Check for alerts stuck in "pending" status for over 30 minutes.
    //    This catches situations where the alert worker loop is alive but
    //    failing silently on every delivery attempt.
    const stuckResult = await client.query(
      `SELECT COUNT(*) AS cnt FROM siem_alerts
       WHERE status = 'pending' AND created_at < now() - interval '30 minutes'`,
    );
    const stuckCount = Number(stuckResult.rows[0]?.cnt ?? 0);
    if (stuckCount > 50) {
      console.warn(`WARNING: ${stuckCount} alerts stuck in pending status >30min`);
    }

    // 3. Check for high failure rate: if failedTotal is >0 and sentTotal is 0,
    //    the worker is running but all deliveries are failing.
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

  // Check for all-fail scenario: worker is alive but every alert delivery fails
  if (status.failedTotal > 0 && status.sentTotal === 0 && status.queuedTotal > 10) {
    console.warn(`WARNING: 0 alerts sent but ${status.failedTotal} failed out of ${status.queuedTotal} queued — delivery may be broken`);
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
