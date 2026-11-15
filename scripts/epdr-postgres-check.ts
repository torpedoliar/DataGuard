#!/usr/bin/env tsx
/**
 * Isolated PostgreSQL verification for the EPDR migrations/queue semantics.
 *
 * This never reads .env, never touches an existing database and never calls a
 * provider. It starts a disposable local `postgres:15-alpine` container on a
 * random loopback port with a random password, applies the handwritten journal,
 * runs synthetic constraint checks, and always removes the container.
 *
 * Usage: npm run test:epdr:postgres
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";

const IMAGE = "postgres:15-alpine";
const name = `dc-check-epdr-verify-${randomBytes(4).toString("hex")}`;
const password = randomBytes(18).toString("base64url");

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("no free port")));
    });
  });
}

async function waitReady(container: string, deadlineMs: number): Promise<void> {
  while (Date.now() < deadlineMs) {
    try {
      docker(["exec", container, "pg_isready", "-U", "postgres"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error("isolated PostgreSQL did not become ready");
}

async function main(): Promise<number> {
  if (!process.argv.includes("--run-isolated")) {
    console.error("Refusing to run: pass --run-isolated to start a disposable local PostgreSQL container.");
    return 2;
  }
  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    console.error("Refusing to run with DATABASE_URL/DB_HOST configured: this check must stay isolated.");
    return 2;
  }

  const port = await freePort();
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (checkName: string, ok: boolean, detail?: string) => {
    checks.push({ name: checkName, ok, detail });
  };
  let client: Client | null = null;
  let containerId: string | null = null;

  try {
    containerId = docker(["run", "-d", "--rm", "--name", name,
      "-e", `POSTGRES_PASSWORD=${password}`,
      "-e", "POSTGRES_HOST_AUTH_METHOD=scram-sha-256",
      "-p", `127.0.0.1:${port}:5432`,
      IMAGE, "postgres", "-c", "fsync=off", "-c", "full_page_writes=off",
    ]);
    await waitReady(containerId, Date.now() + 60_000);

    client = new Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
    await client.connect();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name = ANY($1::text[]) ORDER BY table_name`,
      [["epdr_read_sync_requests", "epdr_playbook_versions", "epdr_playbook_runs",
        "epdr_incident_handoffs", "epdr_local_playbook_runs", "epdr_local_playbook_steps",
        "epdr_local_notification_policies", "epdr_local_notification_outbox",
        "epdr_local_notifications", "epdr_local_notification_audit", "epdr_detection_read_evidence",
        "epdr_local_approvals"]],
    );
    check("all registered EPDR migrations applied", tables.rowCount === 12, tables.rows.map((r) => r.table_name).join(","));

    const revisions = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'account_revision'
       AND table_name IN ('epdr_endpoints', 'epdr_detections') ORDER BY table_name`,
    );
    check("account revision provenance columns exist", revisions.rowCount === 2);

    // Minimal synthetic fixtures only.
    const site = await client.query<{ id: number }>(`INSERT INTO sites (name, code) VALUES ('EPDR verify', 'EPDRV') RETURNING id`);
    const siteId = site.rows[0].id;
    const user = await client.query<{ id: number }>(`INSERT INTO users (username, password_hash, role) VALUES ('epdr-verify', 'x', 'admin') RETURNING id`);
    const userId = user.rows[0].id;
    await client.query(`INSERT INTO user_sites (user_id, site_id, role_in_site) VALUES ($1, $2, 'admin')`, [userId, siteId]);
    const conn = await client.query<{ id: number }>(
      `INSERT INTO watchguard_connections (site_id, region, account_id, enabled, account_revision)
       VALUES ($1, 'jpn', 'acct-verify', true, 1) RETURNING id`, [siteId]);
    const connId = conn.rows[0].id;

    await client.query(`INSERT INTO epdr_detection_read_evidence
      (connection_id, account_revision, credential_revision, source, status, "window", started_at, finished_at, event_types, completed_event_types)
      VALUES ($1, 1, 0, 'threatsync', 'completed', 'provider_default', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute', '{}', '{}'),
        ($1, 1, 0, 'threatsync', 'failed', 'provider_default', clock_timestamp() - interval '30 seconds', clock_timestamp(), '{}', '{}')`, [connId]);
    const latestEvidence = await client.query<{ status: string }>(`SELECT status FROM epdr_detection_read_evidence
      WHERE connection_id = $1 AND account_revision = 1 AND credential_revision = 0 AND source = 'threatsync'
      ORDER BY started_at DESC, id DESC LIMIT 1`, [connId]);
    check("latest failed source read supersedes earlier successful evidence", latestEvidence.rows[0]?.status === "failed");
    let invalidEvidenceRejected = false;
    try {
      await client.query(`INSERT INTO epdr_detection_read_evidence
        (connection_id, account_revision, credential_revision, source, status, "window", started_at, finished_at, event_types, completed_event_types)
        VALUES ($1, 1, 0, 'threatsync', 'completed', 'provider_default', clock_timestamp(), clock_timestamp() - interval '1 minute', '{}', '{}')`, [connId]);
    } catch { invalidEvidenceRejected = true; }
    check("source evidence rejects inverted attempt timestamps", invalidEvidenceRejected);

    // Queue: one pending per connection, DB-time cooldown and SKIP LOCKED claims.
    await client.query(`INSERT INTO epdr_read_sync_requests (connection_id, site_id, account_revision, requested_by)
      VALUES ($1, $2, 1, $3)`, [connId, siteId, userId]);
    let duplicateRejected = false;
    try {
      await client.query(`INSERT INTO epdr_read_sync_requests (connection_id, site_id, account_revision, requested_by)
        VALUES ($1, $2, 1, $3)`, [connId, siteId, userId]);
    } catch { duplicateRejected = true; }
    check("queue dedups a second pending request", duplicateRejected);

    const holder = new Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
    const contender = new Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
    await holder.connect();
    await contender.connect();
    await holder.query("BEGIN");
    const claimed = await holder.query<{ id: number }>(`WITH candidate AS (
      SELECT id FROM epdr_read_sync_requests
      WHERE status = 'queued' AND available_at <= clock_timestamp()
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE epdr_read_sync_requests r SET status = 'running', lease_token = gen_random_uuid()::text,
        lease_until = clock_timestamp() + interval '10 minutes'
      FROM candidate WHERE r.id = candidate.id RETURNING r.id`);
    await contender.query("BEGIN");
    const skipped = await contender.query<{ id: number }>(`WITH candidate AS (
      SELECT id FROM epdr_read_sync_requests
      WHERE status = 'queued' AND available_at <= clock_timestamp()
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE epdr_read_sync_requests r SET status = 'running'
      FROM candidate WHERE r.id = candidate.id RETURNING r.id`);
    check("concurrent claim uses SKIP LOCKED (one winner)", claimed.rowCount === 1 && skipped.rowCount === 0);
    await contender.query("ROLLBACK");
    await holder.query("ROLLBACK");
    await holder.end();
    await contender.end();

    // Handoff uniqueness is per detection.
    const endpoint = await client.query<{ id: number }>(
      `INSERT INTO epdr_endpoints (connection_id, site_id, account_revision, wg_device_id, host_name, last_synced_at, raw)
       VALUES ($1, $2, 1, 'verify-device', 'verify-host', clock_timestamp(), '{}'::jsonb) RETURNING id`,
      [connId, siteId]);
    const reboundEndpoint = await client.query<{ id: number; device_id: number | null }>(
      `INSERT INTO epdr_endpoints (connection_id, site_id, account_revision, wg_device_id, host_name, last_synced_at, raw)
       VALUES ($1, $2, 2, 'verify-device', 'rebound-host', clock_timestamp(), '{}'::jsonb) RETURNING id, device_id`,
      [connId, siteId]);
    const originalEndpoint = await client.query<{ host_name: string }>(
      "SELECT host_name FROM epdr_endpoints WHERE id = $1", [endpoint.rows[0].id]);
    check("account rebind preserves endpoint identity without inheriting an asset",
      reboundEndpoint.rows[0].id !== endpoint.rows[0].id && reboundEndpoint.rows[0].device_id === null
      && originalEndpoint.rows[0].host_name === "verify-host");
    const incident = await client.query<{ id: number }>(
      `INSERT INTO incidents (site_id, epdr_endpoint_id, title, severity, status, source, assigned_to_id)
       VALUES ($1, $2, 'verify', 'High', 'Open', 'epdr_manual', $3) RETURNING id`, [siteId, endpoint.rows[0].id, userId]);
    const detection = await client.query<{ id: number }>(
      `INSERT INTO epdr_detections (connection_id, site_id, source, source_key, account_revision, endpoint_id, category, severity, detected_at, raw)
       VALUES ($1, $2, 'threatsync', 'verify-1', 1, $3, 'malware', 'High', clock_timestamp(), '{}'::jsonb) RETURNING id`,
      [connId, siteId, endpoint.rows[0].id]);
    const detectionId = detection.rows[0].id;
    const reread = await client.query<{ id: number }>(
      `INSERT INTO epdr_detections (connection_id, site_id, source, source_key, account_revision, category, severity, detected_at, raw)
       VALUES ($1, $2, 'threatsync', 'verify-1', 2, 'malware', 'High', clock_timestamp(), '{}'::jsonb) RETURNING id`,
      [connId, siteId]);
    const retained = await client.query<{ account_revision: number }>(
      "SELECT account_revision FROM epdr_detections WHERE id = $1", [detectionId]);
    check("new revision reread preserves historical detection identity", reread.rows[0].id !== detectionId && retained.rows[0].account_revision === 1);
    let repeatedRevisionRejected = false;
    try {
      await client.query(`INSERT INTO epdr_detections (connection_id, site_id, source, source_key, account_revision, category, severity, detected_at, raw)
        VALUES ($1, $2, 'threatsync', 'verify-1', 2, 'malware', 'High', clock_timestamp(), '{}'::jsonb)`, [connId, siteId]);
    } catch { repeatedRevisionRejected = true; }
    check("same revision detection reread remains idempotent", repeatedRevisionRejected);
    await client.query(`INSERT INTO epdr_incident_handoffs (site_id, detection_id, incident_id, connection_id, account_revision, requested_by, note)
      VALUES ($1, $2, $3, $4, 1, $5, 'verify')`, [siteId, detectionId, incident.rows[0].id, connId, userId]);
    let handoffDupRejected = false;
    try {
      await client.query(`INSERT INTO epdr_incident_handoffs (site_id, detection_id, incident_id, connection_id, account_revision, requested_by, note)
        VALUES ($1, $2, $3, $4, 1, $5, 'verify-2')`, [siteId, detectionId, incident.rows[0].id, connId, userId]);
    } catch { handoffDupRejected = true; }
    check("handoff is unique per detection", handoffDupRejected);

    // Composite site FK rejects a cross-site detection/version pairing attempt.
    let crossSiteRejected = false;
    try {
      await client.query(`INSERT INTO epdr_incident_handoffs (site_id, detection_id, incident_id, connection_id, account_revision, note)
        VALUES ($1, $2, $3, $4, 1, 'verify')`, [siteId + 999, detectionId, incident.rows[0].id, connId]);
    } catch { crossSiteRejected = true; }
    check("composite site/connection constraints reject mismatches", crossSiteRejected);

    // Local playbook immutability trigger rejects evidence rewrites.
    const version = await client.query<{ id: number }>(
      `INSERT INTO epdr_playbook_versions (site_id, template_id, version, name, mode, configuration, definition)
       VALUES ($1, 'ioa', 1, 'verify', 'simulate', '{}'::jsonb, '{}'::jsonb) RETURNING id`, [siteId]);
    const run = await client.query<{ id: number }>(
      `INSERT INTO epdr_local_playbook_runs (site_id, version_id, detection_id, connection_id, account_revision, requested_by, evidence)
       VALUES ($1, $2, $3, $4, 1, $5, '{"verify":true}'::jsonb) RETURNING id`,
      [siteId, version.rows[0].id, detectionId, connId, userId]);
    let immutable = false;
    try {
      await client.query(`UPDATE epdr_local_playbook_runs SET evidence = '{"changed":true}'::jsonb WHERE id = $1`, [run.rows[0].id]);
    } catch { immutable = true; }
    check("local playbook evidence is trigger-immutable", immutable);

    // Durable local approval: unique per run+intent and second-decider CHECK.
    const approval = await client.query<{ id: number }>(`INSERT INTO epdr_local_approvals
      (site_id, detection_id, local_run_id, endpoint_id, connection_id, account_revision, action_intent, snapshot, requested_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, 1, 'scan', '{"providerLocked":true}'::jsonb, $6,
        clock_timestamp() + interval '24 hours') RETURNING id`,
      [siteId, detectionId, run.rows[0].id, endpoint.rows[0].id, connId, userId]);
    check("local approval persisted", approval.rowCount === 1);
    let approvalDupRejected = false;
    try {
      await client.query(`INSERT INTO epdr_local_approvals
        (site_id, detection_id, local_run_id, endpoint_id, connection_id, account_revision, action_intent, snapshot, requested_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, 1, 'scan', '{}'::jsonb, $6, clock_timestamp() + interval '24 hours')`,
        [siteId, detectionId, run.rows[0].id, endpoint.rows[0].id, connId, userId]);
    } catch { approvalDupRejected = true; }
    check("local approval is unique per run and intent", approvalDupRejected);
    let selfApprovalRejected = false;
    try {
      await client.query(`UPDATE epdr_local_approvals SET status = 'approved', decided_by = $2,
        decided_at = clock_timestamp() WHERE id = $1`, [approval.rows[0].id, userId]);
    } catch { selfApprovalRejected = true; }
    check("local approval requires a different decider", selfApprovalRejected);
    let approvalCrossSiteRejected = false;
    try {
      await client.query(`INSERT INTO epdr_local_approvals
        (site_id, detection_id, local_run_id, endpoint_id, connection_id, account_revision, action_intent, snapshot, requested_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, 1, 'isolate', '{}'::jsonb, $6, clock_timestamp() + interval '24 hours')`,
        [siteId + 999, detectionId, run.rows[0].id, endpoint.rows[0].id, connId, userId]);
    } catch { approvalCrossSiteRejected = true; }
    check("local approval composite tenancy rejects mismatches", approvalCrossSiteRejected);

    // Real scheduling statement shape: policy opt-in, active assignee, dedup.
    await client.query(`INSERT INTO epdr_local_notification_policies (site_id, enabled, notify_held, quiet_start, quiet_end, updated_by)
      VALUES ($1, true, true, 22, 7, $2)`, [siteId, userId]);
    const quietPolicy = await client.query<{ quiet_start: number; quiet_end: number }>(
      "SELECT quiet_start, quiet_end FROM epdr_local_notification_policies WHERE site_id = $1", [siteId]);
    check("quiet window hours persist for the local policy",
      quietPolicy.rows[0]?.quiet_start === 22 && quietPolicy.rows[0]?.quiet_end === 7);
    let equalQuietRejected = false;
    try {
      await client.query("UPDATE epdr_local_notification_policies SET quiet_start = 7, quiet_end = 7 WHERE site_id = $1", [siteId]);
    } catch { equalQuietRejected = true; }
    check("quiet window constraint rejects equal start/end hours", equalQuietRejected);
    await client.query("UPDATE epdr_local_notification_policies SET escalate_overdue_to_admins = true WHERE site_id = $1", [siteId]);
    const escalation = await client.query<{ escalate_overdue_to_admins: boolean }>(
      "SELECT escalate_overdue_to_admins FROM epdr_local_notification_policies WHERE site_id = $1", [siteId]);
    check("overdue escalation is opt-in and persisted", escalation.rows[0]?.escalate_overdue_to_admins === true);
    let digestPairRejected = false;
    try {
      await client.query("UPDATE epdr_local_notification_policies SET digest_enabled = true, digest_hour_utc = NULL WHERE site_id = $1", [siteId]);
    } catch { digestPairRejected = true; }
    check("digest policy requires an hour only when enabled", digestPairRejected);
    await client.query("UPDATE epdr_local_notification_policies SET digest_enabled = true, digest_hour_utc = 8 WHERE site_id = $1", [siteId]);
    const digestPolicy = await client.query<{ digest_enabled: boolean; digest_hour_utc: number }>(
      "SELECT digest_enabled, digest_hour_utc FROM epdr_local_notification_policies WHERE site_id = $1", [siteId]);
    check("digest policy persists an enabled UTC hour",
      digestPolicy.rows[0]?.digest_enabled === true && digestPolicy.rows[0]?.digest_hour_utc === 8);
    const digestRow = await client.query<{ id: number }>(`INSERT INTO epdr_local_notification_outbox
      (site_id, incident_id, recipient_id, kind, available_at, digest_day)
      VALUES ($1, NULL, $2, 'digest', clock_timestamp(), (clock_timestamp() AT TIME ZONE 'UTC')::date) RETURNING id`,
      [siteId, userId]);
    check("digest outbox row allows a null incident target", digestRow.rowCount === 1);
    let digestDayDuplicateRejected = false;
    try {
      await client.query(`INSERT INTO epdr_local_notification_outbox
        (site_id, incident_id, recipient_id, kind, available_at, digest_day)
        VALUES ($1, NULL, $2, 'digest', clock_timestamp(), (clock_timestamp() AT TIME ZONE 'UTC')::date)`,
        [siteId, userId]);
    } catch { digestDayDuplicateRejected = true; }
    check("digest is unique per recipient and UTC day", digestDayDuplicateRejected);
    let digestTargetRejected = false;
    try {
      await client.query(`INSERT INTO epdr_local_notification_outbox
        (site_id, incident_id, recipient_id, kind, available_at, digest_day)
        VALUES ($1, NULL, $2, 'assigned', clock_timestamp(), NULL)`, [siteId, userId]);
    } catch { digestTargetRejected = true; }
    check("non-digest outbox rows still require an incident", digestTargetRejected);
    await client.query(`INSERT INTO epdr_local_notifications (outbox_id, site_id, incident_id, recipient_id, kind)
      VALUES ($1, $2, NULL, $3, 'digest')`, [digestRow.rows[0].id, siteId, userId]);
    check("digest notification stores a null incident target", true);
    const scheduled = await client.query(`INSERT INTO epdr_local_notification_outbox
      (site_id, incident_id, recipient_id, kind, available_at)
      SELECT i.site_id, i.id, i.assigned_to_id, k.kind,
        CASE WHEN k.kind = 'overdue' THEN i.due_date ELSE clock_timestamp() END
      FROM incidents i JOIN epdr_local_notification_policies p ON p.site_id = i.site_id
      JOIN users u ON u.id = i.assigned_to_id AND u.is_active = true
      JOIN user_sites m ON m.user_id = u.id AND m.site_id = i.site_id
      CROSS JOIN (VALUES ('assigned'), ('overdue')) k(kind)
      WHERE i.site_id = $1 AND i.source = 'epdr_manual' AND p.enabled = true
        AND (i.automation_hold = false OR p.notify_held = true)
        AND i.status IN ('Open', 'In Progress') AND (k.kind <> 'overdue' OR i.due_date IS NOT NULL)
      ON CONFLICT (incident_id, recipient_id, kind) DO NOTHING`, [siteId]);
    check("local notification scheduling inserts one assignee notice (overdue waits for due date)", scheduled.rowCount === 1);

    // Notification dedup per incident/recipient/kind (the scheduler already inserted one).
    let notificationDup = false;
    try {
      await client.query(`INSERT INTO epdr_local_notification_outbox (site_id, incident_id, recipient_id, kind, available_at)
        VALUES ($1, $2, $3, 'assigned', clock_timestamp())`, [siteId, incident.rows[0].id, userId]);
    } catch { notificationDup = true; }
    check("local notification outbox dedups recipient/kind", notificationDup);
  } catch (error) {
    checks.push({ name: "verification run", ok: false, detail: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
  } finally {
    try { await client?.end(); } catch { /* connection may already be closed */ }
    if (containerId) {
      try {
        docker(["rm", "-f", containerId]);
      } catch {
        checks.push({ name: "isolated container cleanup", ok: false, detail: "Could not confirm container removal." });
      }
    }
  }

  for (const item of checks) {
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed (isolated verification).`);
  return failed === 0 ? 0 : 1;
}

void main().then((code) => process.exit(code)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "isolated verification failed");
  process.exit(1);
});
