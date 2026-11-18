#!/usr/bin/env tsx
/**
 * Integration verification for the provider-write reservation pipeline.
 *
 * Unlike `epdr-postgres-check.ts` (SQL-shape checks), this entry imports the
 * REAL application functions — `claimNextDispatch`, `expireExpiredApprovals`,
 * `runExecutionRetention`, `buildExecutionSnapshot` — against a disposable
 * isolated PostgreSQL, including a `Promise.all` concurrency test that proves
 * the committed attempt count never exceeds the per-site cap.
 *
 * The container never touches an existing database and is always removed.
 * Usage: npm run test:epdr:postgres:integration
 */
import { sql } from "drizzle-orm";
import { startIsolatedPostgres, verifyIsolatedInvocation } from "./lib/isolated-postgres";

async function main(): Promise<number> {
  const refused = verifyIsolatedInvocation(process.argv);
  if (refused !== null) return refused;

  const pg = await startIsolatedPostgres("dc-check-epdr-integration");
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  try {
    {
      const client = pg.createClient();
      await client.connect();
      await pg.runMigrations();
      await client.end();
    }

    // Configure the app environment BEFORE any @/db access: the database proxy
    // is lazy, so the first access pins this connection string and secret.
    process.env.DATABASE_URL = `postgresql://postgres:${pg.password}@127.0.0.1:${pg.port}/postgres`;
    process.env.AI_KEY_ENCRYPTION_SECRET = "isolated-integration-secret-0123456789abcdef";

    const [{ db }, { encryptString }, { executionSnapshotHash }, { buildExecutionSnapshot },
      { claimNextDispatch, expireExpiredApprovals }, { runExecutionRetention }] = await Promise.all([
      import("@/db"), import("@/lib/crypto"), import("@/lib/epdr/execution-request"),
      import("@/lib/epdr/execution-snapshot"), import("@/lib/epdr/execution-jobs"),
      import("@/lib/epdr/retention"),
    ]);

    const seed = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, expectRows = true): Promise<T[]> => {
      const { rows } = await db.execute<T>(query);
      if (expectRows && rows.length === 0) throw new Error("seed row missing");
      return rows as T[];
    };
    const siteId = (await seed<{ id: number }>(sql`INSERT INTO sites (name, code) VALUES ('EPDR integration', 'EPDRI') RETURNING id`))[0]!.id;
    const requesterId = (await seed<{ id: number }>(sql`INSERT INTO users (username, password_hash, role)
      VALUES ('int-requester', 'x', 'admin') RETURNING id`))[0]!.id;
    const approverId = (await seed<{ id: number }>(sql`INSERT INTO users (username, password_hash, role)
      VALUES ('int-approver', 'x', 'admin') RETURNING id`))[0]!.id;
    for (const userId of [requesterId, approverId]) {
      await db.execute(sql`INSERT INTO user_sites (user_id, site_id, role_in_site) VALUES (${userId}, ${siteId}, 'admin')`);
    }
    const connId = (await seed<{ id: number }>(sql`INSERT INTO watchguard_connections
      (site_id, region, account_id, enabled, account_revision, credential_revision, rw_access_id, rw_password,
        endpoint_sync_minutes, last_endpoint_sync_at, last_sync_error)
      VALUES (${siteId}, 'jpn', 'acct-integration', true, 1, 0, 'rw-int', ${encryptString("isolated-password")},
        15, clock_timestamp(), NULL)
      RETURNING id`))[0]!.id;
    // The journal seeds a default (writes-off) global row; raise it explicitly
    // instead of relying on ON CONFLICT DO NOTHING.
    await db.execute(sql`INSERT INTO watchguard_global_settings (id, provider_writes_enabled, allowed_actions, max_actions_per_hour_per_site)
      VALUES (1, true, ARRAY['scan']::text[], 2) ON CONFLICT (id) DO UPDATE SET
        provider_writes_enabled = true, allowed_actions = ARRAY['scan']::text[], max_actions_per_hour_per_site = 2`);
    await db.execute(sql`INSERT INTO epdr_site_settings (site_id, provider_writes_enabled, allowed_actions,
        max_actions_per_hour, execution_cooldown_minutes)
      VALUES (${siteId}, true, ARRAY['scan']::text[], NULL, 0)`);

    // One live endpoint per candidate request; snapshots come from the real
    // builder so a later rebuild in the claim path hashes identically.
    const expiresAt = Date.now() + 60 * 60_000;
    const seedApprovedAction = async (index: number): Promise<{ actionId: number; endpointId: number }> => {
      const endpointId = (await seed<{ id: number }>(sql`INSERT INTO epdr_endpoints
        (connection_id, site_id, account_revision, wg_device_id, host_name, last_synced_at, last_connection_at, raw)
        VALUES (${connId}, ${siteId}, 1, ${"int-device-" + index}, ${"int-host-" + index},
          clock_timestamp(), clock_timestamp(), '{}'::jsonb) RETURNING id`))[0]!.id;
      const built = await buildExecutionSnapshot({ siteId, endpointId, actionType: "scan", parameters: {}, requesterId, expiresAt });
      if (!built.ok) throw new Error(`snapshot build failed: ${built.reason}`);
      const hash = executionSnapshotHash(built.snapshot);
      const actionId = (await seed<{ id: number }>(sql`INSERT INTO epdr_actions
        (site_id, connection_id, endpoint_id, action_type, params, mode, state, idempotency_key,
          requested_by, approved_by, approved_at, approved_snapshot_hash, snapshot, snapshot_hash,
          approval_expires_at, account_revision, credential_revision, evidence_generation, namespace, device_id)
        VALUES (${siteId}, ${connId}, ${endpointId}, 'scan', ${JSON.stringify(built.snapshot.parameters)}::jsonb,
          'approval', 'queued', ${"int-key-" + index}, ${requesterId}, ${approverId}, clock_timestamp(),
          ${hash}, ${JSON.stringify(built.snapshot)}::jsonb, ${hash}, ${new Date(expiresAt)}, 1, 0, 0,
          'endpoint_security', 'int-device-' || ${index})
        RETURNING id`))[0]!.id;
      return { actionId, endpointId };
    };
    const candidates = [];
    for (let index = 1; index <= 6; index++) candidates.push(await seedApprovedAction(index));
    check("six approved requests seeded through the real snapshot builder", candidates.length === 6);

    // Sweep: only the request past its approval window is cancelled, with the
    // explicit reason and without touching anything else.
    const expiredId = candidates[0]!.actionId;
    await db.execute(sql`UPDATE epdr_actions SET approval_expires_at = clock_timestamp() - interval '1 minute'
      WHERE id = ${expiredId}`);
    const swept = await expireExpiredApprovals(connId);
    const expiredState = (await db.execute<{ state: string; review_reason: string }>(sql`
      SELECT state, review_reason FROM epdr_actions WHERE id = ${expiredId}`)).rows[0];
    check("real sweep cancels the expired approval with the explicit reason",
      swept === 1 && expiredState?.state === "cancelled" && expiredState.review_reason === "approval_expired");

    // Concurrency: six simultaneous claims against a cap of 2 per hour. The
    // per-site mutex serializes the reservation; only two attempt rows commit.
    const claimed = await Promise.all(
      candidates.map((candidate) => claimNextDispatch(siteId, connId, "worker:integration")),
    );
    const wonIds = claimed.filter(Boolean).map((work) => work!.actionId).sort((a, b) => a - b);
    const uniqueWinners = new Set(wonIds).size === wonIds.length;
    // A claim whose post-claim revalidation aborts still commits its attempt
    // row, so the reservation invariants are measured on the committed rows.
    const { rows: attemptCounts } = await db.execute<{ total: string; claimed_events: string; distinct_actions: string }>(sql`
      SELECT (SELECT count(*)::text FROM epdr_attempts WHERE phase = 'dispatch') AS total,
        (SELECT count(*)::text FROM epdr_attempt_events WHERE event = 'claimed') AS claimed_events,
        (SELECT count(DISTINCT action_id)::text FROM epdr_attempts WHERE phase = 'dispatch') AS distinct_actions`);
    const attempts = Number(attemptCounts[0]?.total ?? 0);
    const claimedEvents = Number(attemptCounts[0]?.claimed_events ?? 0);
    const distinctActions = Number(attemptCounts[0]?.distinct_actions ?? 0);
    check("concurrent claims never exceed the per-site cap (cap=2)", attempts <= 2, `attempts=${attempts}`);
    check("every committed reservation is a distinct action", uniqueWinners && distinctActions === attempts,
      `distinct=${distinctActions}`);
    check("attempt rows commit with their claimed ledger event", claimedEvents === attempts,
      `events=${claimedEvents}`);

    // Retention: only terminal-action attempts past the window are deleted;
    // results are redacted; the second pass is idempotent.
    const survivor = candidates[1]!.actionId;
    const terminalId = candidates[2]!.actionId;
    await db.execute(sql`UPDATE epdr_actions SET state = 'completed',
      result = '{"receipt":"isolated"}'::jsonb, updated_at = clock_timestamp() - interval '200 days'
      WHERE id = ${terminalId}`);
    await db.execute(sql`UPDATE epdr_attempts SET started_at = clock_timestamp() - interval '200 days'
      WHERE action_id = ${terminalId} OR action_id = ${survivor}`);
    const firstPass = await runExecutionRetention({ batchSize: 500 });
    const terminalAttempts = Number((await db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total FROM epdr_attempts WHERE action_id = ${terminalId}`)).rows[0]?.total ?? 0);
    const survivorAttempts = Number((await db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total FROM epdr_attempts WHERE action_id = ${survivor}`)).rows[0]?.total ?? 0);
    const redacted = (await db.execute<{ result: unknown }>(sql`
      SELECT result FROM epdr_actions WHERE id = ${terminalId}`)).rows[0]?.result;
    check("retention deletes only terminal-action attempts and redacts the result",
      firstPass.deletedAttempts >= 1 && terminalAttempts === 0 && survivorAttempts >= 1 && redacted === null,
      `deleted=${firstPass.deletedAttempts}`);
    const secondPass = await runExecutionRetention({ batchSize: 500 });
    check("retention is idempotent (second pass deletes nothing)", secondPass.deletedAttempts === 0,
      `deleted=${secondPass.deletedAttempts}`);
  } catch (error) {
    checks.push({ name: "integration run", ok: false, detail: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
  } finally {
    try {
      const { db } = await import("@/db");
      await db.execute(sql`SELECT 1`).catch(() => undefined);
    } catch { /* pool may already be gone */ }
    pg.cleanup();
  }

  for (const item of checks) {
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed (isolated integration).`);
  return failed === 0 ? 0 : 1;
}

void main().then((code) => process.exit(code)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "isolated integration failed");
  process.exit(1);
});
