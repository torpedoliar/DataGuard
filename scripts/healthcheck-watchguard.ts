#!/usr/bin/env tsx
/**
 * Worker-process healthcheck for the WatchGuard EPDR pipeline.
 *
 * Exit 0 only when a worker heartbeat is fresh and every execution-stuck
 * counter stays inside its threshold. Exit 1 makes compose restart or flag
 * the worker. No external alert is sent from here; thresholds are env-tunable
 * so an operator can widen them during a migration window.
 */
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const WORKER_MAX_STALENESS_MS = Number(process.env.EPDR_WORKER_MAX_STALENESS_MS || 5 * 60_000);
const EXPIRED_APPROVAL_MAX = Number(process.env.EPDR_EXPIRED_APPROVAL_MAX || 0);
const STALE_LEASE_MAX = Number(process.env.EPDR_STALE_LEASE_MAX || 5);
const OVERDUE_MAX = Number(process.env.EPDR_OVERDUE_MAX || 5);
const ORPHAN_ATTEMPT_MAX = Number(process.env.EPDR_ORPHAN_ATTEMPT_MAX || 5);

function fail(message: string): never {
  console.error(`UNHEALTHY: ${message}`);
  process.exit(1);
}

async function main(): Promise<never> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail("DATABASE_URL not configured");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch {
    fail("database unreachable");
  }
  try {
    const heartbeat = await client.query<{ latest: string | null; workers: string }>(
      "SELECT max(last_pass_at)::text AS latest, count(*)::text AS workers FROM epdr_worker_heartbeats",
    ).catch((error: { code?: string }) => {
      if (error.code === "42P01") fail("epdr_worker_heartbeats missing (migrations not applied)");
      throw error;
    });
    const workers = Number(heartbeat.rows[0]?.workers ?? 0);
    const latest = heartbeat.rows[0]?.latest ? new Date(heartbeat.rows[0]!.latest) : null;
    if (workers === 0 || !latest) fail("no worker heartbeat recorded");
    const ageMs = Date.now() - latest!.getTime();
    if (ageMs > WORKER_MAX_STALENESS_MS) {
      fail(`worker heartbeat stale (${Math.round(ageMs / 1000)}s old, limit ${Math.round(WORKER_MAX_STALENESS_MS / 1000)}s)`);
    }

    const counts = await client.query<{
      expired_approval: string; stale_lease: string; overdue: string; orphan_attempts: string;
    }>(`SELECT
        (SELECT count(*) FROM epdr_actions WHERE mode = 'approval' AND namespace IS NOT NULL
          AND state IN ('pending_approval', 'queued')
          AND approval_expires_at IS NOT NULL AND approval_expires_at <= clock_timestamp()) AS expired_approval,
        (SELECT count(*) FROM epdr_actions WHERE mode = 'approval' AND namespace IS NOT NULL
          AND state = 'dispatching' AND lease_expires_at IS NOT NULL AND lease_expires_at <= clock_timestamp()) AS stale_lease,
        (SELECT count(*) FROM epdr_actions WHERE mode = 'approval' AND namespace IS NOT NULL
          AND state IN ('in_progress', 'outcome_unknown')
          AND deadline_at IS NOT NULL AND deadline_at <= clock_timestamp()) AS overdue,
        (SELECT count(*) FROM epdr_attempts a JOIN epdr_actions x ON x.id = a.action_id
          WHERE a.phase = 'dispatch' AND a.status = 'sending' AND x.state <> 'dispatching') AS orphan_attempts`,
    ).catch((error: { code?: string }) => {
      if (error.code === "42P01") fail("epdr execution tables missing (migrations not applied)");
      throw error;
    });
    const row = counts.rows[0]!;
    const expired = Number(row.expired_approval);
    const staleLease = Number(row.stale_lease);
    const overdue = Number(row.overdue);
    const orphans = Number(row.orphan_attempts);

    if (expired > EXPIRED_APPROVAL_MAX) fail(`${expired} expired approvals awaiting sweep (limit ${EXPIRED_APPROVAL_MAX})`);
    if (staleLease > STALE_LEASE_MAX) fail(`${staleLease} stale dispatch leases (limit ${STALE_LEASE_MAX})`);
    if (overdue > OVERDUE_MAX) fail(`${overdue} overdue observations (limit ${OVERDUE_MAX})`);
    if (orphans > ORPHAN_ATTEMPT_MAX) fail(`${orphans} orphan dispatch attempts (limit ${ORPHAN_ATTEMPT_MAX})`);

    console.log(`HEALTHY: worker heartbeat ${Math.round(ageMs / 1000)}s old, expired=${expired} staleLease=${staleLease} overdue=${overdue} orphans=${orphans}`);
    process.exit(0);
  } catch (error) {
    fail(`check failed: ${error instanceof Error ? error.message : "unknown"}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main();
