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
import { Client } from "pg";
import { startIsolatedPostgres, verifyIsolatedInvocation } from "./lib/isolated-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { overviewCountsQuery } from "../lib/epdr/overview-query";

async function main(): Promise<number> {
  const refused = verifyIsolatedInvocation(process.argv);
  if (refused !== null) return refused;

  const pg = await startIsolatedPostgres("dc-check-epdr-verify");
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (checkName: string, ok: boolean, detail?: string) => {
    checks.push({ name: checkName, ok, detail });
  };
  let client: Client | null = null;

  try {
    client = pg.createClient();
    await client.connect();
    await pg.runMigrations();

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

    const holder = pg.createClient();
    const contender = pg.createClient();
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
    // Action SQL regressions: local runs intentionally have no endpoint_id.
    const approvalRun = await client.query(`SELECT id, status, evidence, detection_id
      FROM epdr_local_playbook_runs WHERE id = $1 AND site_id = $2
        AND connection_id = $3 AND account_revision = 1 FOR SHARE`, [run.rows[0].id, siteId, connId]);
    check("local approval reads run without nonexistent endpoint column", approvalRun.rowCount === 1);
    const resolveEndpoint = async (capturedId: number | null, revision = 1, scopedSite = siteId) => client!.query<{ id: number }>(`
      SELECT e.id FROM epdr_detections d
      JOIN epdr_endpoints e ON e.id = d.endpoint_id AND e.site_id = d.site_id
        AND e.connection_id = d.connection_id AND e.account_revision = d.account_revision
      WHERE d.id = $1 AND d.site_id = $2 AND d.connection_id = $3 AND d.account_revision = $4
        AND ($5::integer IS NULL OR e.id = $5) AND e.removed_at IS NULL FOR SHARE OF d, e`,
    [detectionId, scopedSite, connId, revision, capturedId]);
    check("legacy local approval resolves a current detection endpoint", (await resolveEndpoint(null)).rows[0]?.id === endpoint.rows[0].id);
    check("captured local approval endpoint remains bound", (await resolveEndpoint(endpoint.rows[0].id)).rowCount === 1);
    check("local approval refuses a changed captured endpoint", (await resolveEndpoint(endpoint.rows[0].id + 999)).rowCount === 0);
    check("local approval refuses a different account revision", (await resolveEndpoint(null, 999)).rowCount === 0);
    check("local approval refuses a different site", (await resolveEndpoint(null, 1, siteId + 999)).rowCount === 0);
    const extracted = await client.query<{ entity_id: string }>(`
      SELECT substring(substring(d.source_key from 4) from position(':' in substring(d.source_key from 4)) + 1) AS entity_id
      FROM (VALUES ('ts:incident:entity:with:colons')) AS d(source_key)`);
    check("provider target PostgreSQL POSITION IN preserves entity suffix", extracted.rows[0]?.entity_id === "entity:with:colons");
    const targetEndpoint = await client.query(`SELECT e.id FROM epdr_endpoints e
      WHERE e.id = $1 AND e.site_id = $2 AND e.connection_id = $3
        AND e.account_revision = $4 AND e.removed_at IS NULL LIMIT 1`, [endpoint.rows[0].id, siteId, connId, 1]);
    check("provider target endpoint revision query has no out-of-scope alias", targetEndpoint.rowCount === 1);

    let immutable = false;
    try {
      await client.query(`UPDATE epdr_local_playbook_runs SET evidence = '{"changed":true}'::jsonb WHERE id = $1`, [run.rows[0].id]);
    } catch { immutable = true; }
    check("local playbook evidence is trigger-immutable", immutable);

    // Durable local approval: unique per run+intent; self-decisions retain audit fields.
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
    for (const status of ["approved", "rejected"]) {
      let selfDecisionPermitted = false;
      try {
        const decision = await client.query(`UPDATE epdr_local_approvals SET status = $3, decided_by = $2,
          decided_at = clock_timestamp() WHERE id = $1 RETURNING id`, [approval.rows[0].id, userId, status]);
        selfDecisionPermitted = decision.rowCount === 1;
      } catch { /* Report a failed check and continue with the remaining constraints. */ }
      check(`local ${status} self-decision is permitted`, selfDecisionPermitted);
      for (const field of ["decided_by", "decided_at"] as const) {
        let missingDecisionFieldRejected = false;
        try {
          await client.query(`UPDATE epdr_local_approvals SET status = $2, ${field} = NULL WHERE id = $1`,
            [approval.rows[0].id, status]);
        } catch (error) { missingDecisionFieldRejected = (error as { code?: string }).code === "23514"; }
        check(`local ${status} decision rejects missing ${field}`, missingDecisionFieldRejected);
      }
    }
    await client.query(`UPDATE epdr_local_approvals SET status = 'approved', decided_by = $2,
      decided_at = clock_timestamp() WHERE id = $1`, [approval.rows[0].id, userId]);
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

    // ---- 0085: provider write hardening -------------------------------------
    const hardening = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (
         (table_name = 'epdr_site_settings' AND column_name IN ('execution_cooldown_minutes', 'max_actions_per_hour', 'execution_attempt_retention_days', 'execution_result_retention_days'))
         OR (table_name = 'watchguard_connections' AND column_name IN ('last_provider_sync_at', 'last_provider_sync_error'))
         OR (table_name = 'epdr_provider_incidents' AND column_name = 'account_revision')
         OR (table_name = 'epdr_actions' AND column_name = 'action_context')
         OR (table_name = 'epdr_attempts' AND column_name IN ('connection_id', 'endpoint_id', 'action_type'))
       )`);
    check("0085 limit, retention and provenance columns exist", hardening.rowCount === 11, String(hardening.rowCount));
    const hardeningTables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN ('epdr_attempt_events', 'epdr_worker_heartbeats') ORDER BY table_name`);
    check("0085 attempt events and worker heartbeats tables exist", hardeningTables.rowCount === 2);
    const constraintChecks = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'epdr_site_settings'::regclass
       AND conname IN ('epdr_site_settings_execution_cooldown_check', 'epdr_site_settings_max_actions_per_hour_check',
         'epdr_site_settings_execution_attempt_retention_check', 'epdr_site_settings_execution_result_retention_check')`);
    check("0085 site limit and retention CHECK constraints exist", constraintChecks.rowCount === 4);
    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
         'epdr_attempts_phase_started_idx', 'epdr_actions_queue_idx', 'epdr_actions_site_cooldown_idx',
         'epdr_actions_cooldown_idx', 'epdr_provider_incidents_connection_revision_ts_idx',
         'epdr_provider_incident_targets_endpoint_idx')`);
    check("0085 claim/cooldown/queue/ingestion indexes exist", indexes.rowCount === 6);
    let cooldownRejected = false;
    try {
      await client.query(`INSERT INTO epdr_site_settings (site_id, execution_cooldown_minutes, max_actions_per_hour)
        VALUES ($1, 2000, 5)`, [siteId]);
    } catch { cooldownRejected = true; }
    check("cooldown CHECK rejects out-of-range minutes", cooldownRejected);
    let capRejected = false;
    try {
      await client.query(`INSERT INTO epdr_site_settings (site_id, execution_cooldown_minutes, max_actions_per_hour)
        VALUES ($1, 10, 0)`, [siteId]);
    } catch { capRejected = true; }
    check("per-site cap CHECK rejects values below 1", capRejected);
    await client.query(`INSERT INTO epdr_site_settings (site_id, execution_cooldown_minutes, max_actions_per_hour)
      VALUES ($1, 10, NULL)`, [siteId]);
    const siteSettings = await client.query<{ max_actions_per_hour: number | null; execution_cooldown_minutes: number }>(
      "SELECT max_actions_per_hour, execution_cooldown_minutes FROM epdr_site_settings WHERE site_id = $1", [siteId]);
    check("per-site cap NULL follows the global ceiling and cooldown defaults to 10",
      siteSettings.rows[0]?.max_actions_per_hour === null && siteSettings.rows[0]?.execution_cooldown_minutes === 10);

    // 0086: provider approvals may record the requester as approver, without
    // bypassing the existing snapshot-hash integrity constraint. This terminal
    // fixture also gives the append-only event checks a real action row.
    const selfApprovedAction = await client.query<{ requested_by: number; approved_by: number }>(`
      INSERT INTO epdr_actions (site_id, connection_id, endpoint_id, action_type, params, mode, state,
        idempotency_key, requested_by, approved_by, approved_at, approved_snapshot_hash, snapshot, snapshot_hash,
        approval_expires_at, account_revision, credential_revision, namespace, device_id)
      VALUES ($1, $2, $3, 'scan', '{}'::jsonb, 'approval', 'cancelled', 'verify-key-self-approved', $4, $4,
        clock_timestamp(), 'verify-hash', '{}'::jsonb, 'verify-hash',
        clock_timestamp() + interval '30 minutes', 1, 0, 'endpoint_security', 'verify-device')
      RETURNING requested_by, approved_by`, [siteId, connId, endpoint.rows[0].id, userId]);
    check("provider self-approval is permitted and records the administrator",
      selfApprovedAction.rowCount === 1 && selfApprovedAction.rows[0].requested_by === userId
      && selfApprovedAction.rows[0].approved_by === userId);

    // Attempt events: the append-only trigger blocks UPDATE and DELETE on a
    // real row (a zero-row UPDATE never fires a row trigger).
    const eventRow = await client.query<{ id: number }>(`
      WITH action_row AS (SELECT id FROM epdr_actions ORDER BY id LIMIT 1)
      INSERT INTO epdr_attempt_events (action_id, attempt, phase, event, detail)
      SELECT action_row.id, 1, 'dispatch', 'claimed', '{}'::jsonb FROM action_row RETURNING id`);
    let eventUpdatedRejected = false;
    try {
      await client.query(`UPDATE epdr_attempt_events SET event = 'rewritten' WHERE id = $1`, [eventRow.rows[0]!.id]);
    } catch { eventUpdatedRejected = true; }
    check("attempt events reject updates via the append-only trigger", eventUpdatedRejected);
    let eventDeletedRejected = false;
    try {
      await client.query(`DELETE FROM epdr_attempt_events WHERE id = $1`, [eventRow.rows[0]!.id]);
    } catch { eventDeletedRejected = true; }
    check("attempt events reject deletes via the append-only trigger", eventDeletedRejected);

    // Worker heartbeat: one row per worker id, upsert replaces.
    await client.query(`INSERT INTO epdr_worker_heartbeats (worker_id, last_pass_at, last_pass_ran, last_pass_failed)
      VALUES ('worker:verify-1', clock_timestamp(), true, false)`);
    await client.query(`INSERT INTO epdr_worker_heartbeats (worker_id, last_pass_at, last_pass_ran, last_pass_failed)
      VALUES ('worker:verify-1', clock_timestamp(), false, true)
      ON CONFLICT (worker_id) DO UPDATE SET last_pass_at = clock_timestamp(), last_pass_ran = false, last_pass_failed = true`);
    const heartbeat = await client.query<{ last_pass_ran: boolean; last_pass_failed: boolean; workers: string }>(
      "SELECT last_pass_ran, last_pass_failed, count(*)::text AS workers FROM epdr_worker_heartbeats WHERE worker_id = 'worker:verify-1' GROUP BY last_pass_ran, last_pass_failed");
    check("worker heartbeat upserts one row per worker id",
      heartbeat.rows[0]?.last_pass_ran === false && heartbeat.rows[0]?.last_pass_failed === true && heartbeat.rows[0]?.workers === "1");

    // Cooldown anti-join: a cooled-down endpoint cannot block another endpoint.
    // The journal seeds a default (writes-off) global row; raise it explicitly.
    await client.query(`INSERT INTO watchguard_global_settings (id, provider_writes_enabled, allowed_actions, max_actions_per_hour_per_site)
      VALUES (1, true, ARRAY['scan']::text[], 30) ON CONFLICT (id) DO UPDATE SET
        provider_writes_enabled = true, allowed_actions = ARRAY['scan']::text[], max_actions_per_hour_per_site = 30`);
    await client.query(`UPDATE epdr_site_settings SET max_actions_per_hour = NULL, execution_cooldown_minutes = 10 WHERE site_id = $1`, [siteId]);
    const approverUser = await client.query<{ id: number }>(
      `INSERT INTO users (username, password_hash, role) VALUES ('epdr-verify-approver', 'x', 'admin') RETURNING id`);
    const approverId = approverUser.rows[0].id;
    await client.query(`INSERT INTO user_sites (user_id, site_id, role_in_site) VALUES ($1, $2, 'admin')`, [approverId, siteId]);
    const insertQueued = async (endpointRowId: number, key: string): Promise<number> => {
      const { rows } = await client!.query<{ id: number }>(`
        INSERT INTO epdr_actions (site_id, connection_id, endpoint_id, action_type, params, mode, state,
          idempotency_key, requested_by, approved_by, approved_at, approved_snapshot_hash, snapshot, snapshot_hash,
          approval_expires_at, account_revision, credential_revision, namespace, device_id)
        VALUES ($1, $2, $3, 'scan', '{}'::jsonb, 'approval', 'queued', $4, $5, $6, clock_timestamp(),
          'verify-hash', '{}'::jsonb, 'verify-hash',
          clock_timestamp() + interval '30 minutes', 1, 0, 'endpoint_security', 'verify-device')
        RETURNING id`, [siteId, connId, endpointRowId, key, userId, approverId]);
      return rows[0]!.id;
    };
    const cooledAction = await insertQueued(endpoint.rows[0].id, "verify-key-cooled");
    const otherAction = await insertQueued(reboundEndpoint.rows[0].id, "verify-key-other");
    await client.query(`UPDATE epdr_actions SET state = 'dispatching', dispatched_at = clock_timestamp()
      WHERE id = $1`, [cooledAction]);
    const antiJoin = await client.query<{ id: number }>(`
      SELECT x.id FROM epdr_actions x
      WHERE x.site_id = $1 AND x.connection_id = $2
        AND x.mode = 'approval' AND x.state = 'queued' AND x.namespace IS NOT NULL
        AND x.approved_by IS NOT NULL AND x.approved_snapshot_hash IS NOT NULL
        AND x.approval_expires_at > clock_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM epdr_actions prev
          WHERE prev.connection_id = x.connection_id AND prev.endpoint_id = x.endpoint_id
            AND prev.action_type = x.action_type AND prev.dispatched_at IS NOT NULL
            AND prev.dispatched_at > clock_timestamp() - interval '10 minutes'
        )
      ORDER BY x.id ASC FOR UPDATE OF x SKIP LOCKED LIMIT 1`, [siteId, connId]);
    check("cooldown anti-join skips the cooled endpoint without blocking the queue",
      antiJoin.rows[0]?.id === otherAction);

    // Hourly cap is enforced from committed attempts (the claim's own filter).
    const capped = await client.query<{ id: number }>(`
      SELECT x.id FROM epdr_actions x
      WHERE x.site_id = $1 AND x.connection_id = $2 AND x.mode = 'approval' AND x.state = 'queued'
        AND x.namespace IS NOT NULL
        AND (SELECT count(*) FROM epdr_attempts a JOIN epdr_actions xa ON xa.id = a.action_id
          WHERE xa.connection_id = $2 AND a.phase = 'dispatch'
            AND a.started_at > clock_timestamp() - interval '1 hour') >= 30
      LIMIT 1`, [siteId, connId]);
    check("hourly cap counts committed attempts before any claim", capped.rowCount === 0);

    // Sweep: expired approvals are cancelled with the explicit reason.
    const expiredQueued = await insertQueued(endpoint.rows[0].id, "verify-key-expired");
    await client.query(`UPDATE epdr_actions SET approval_expires_at = clock_timestamp() - interval '1 minute'
      WHERE id = $1`, [expiredQueued]);
    const sweep = await client.query<{ id: number; review_reason: string }>(`
      UPDATE epdr_actions SET state = 'cancelled', review_reason = 'approval_expired',
        lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE connection_id = $1 AND mode = 'approval' AND namespace IS NOT NULL
        AND state IN ('pending_approval', 'queued')
        AND approval_expires_at IS NOT NULL AND approval_expires_at <= clock_timestamp()
      RETURNING id, review_reason`, [connId]);
    check("expired approval sweep cancels only lapsed requests with the explicit reason",
      sweep.rows.length === 1 && sweep.rows[0]!.id === expiredQueued && sweep.rows[0]!.review_reason === "approval_expired");

    // Retention shape: only terminal-action attempts qualify; non-terminal stay.
    const terminalAction = await insertQueued(endpoint.rows[0].id, "verify-key-retained");
    const pendingAction = await insertQueued(endpoint.rows[0].id, "verify-key-pending");
    await client.query(`UPDATE epdr_actions SET state = 'completed' WHERE id = $1`, [terminalAction]);
    await client.query(`INSERT INTO epdr_attempts (action_id, attempt, started_at, status, phase)
      VALUES ($1, 1, clock_timestamp() - interval '200 days', 'accepted', 'dispatch')`, [terminalAction]);
    await client.query(`INSERT INTO epdr_attempts (action_id, attempt, started_at, status, phase)
      VALUES ($1, 1, clock_timestamp() - interval '200 days', 'accepted', 'dispatch')`, [pendingAction]);
    const retentionDelete = await client.query<{ id: number }>(`
      DELETE FROM epdr_attempts a
      WHERE a.id IN (
        SELECT a2.id FROM epdr_attempts a2
        JOIN epdr_actions x ON x.id = a2.action_id
        JOIN sites st ON st.id = x.site_id
        LEFT JOIN epdr_site_settings s ON s.site_id = x.site_id
        WHERE x.mode = 'approval' AND x.namespace IS NOT NULL
          AND x.state IN ('completed', 'failed', 'cancelled')
          AND a2.started_at < clock_timestamp() - (interval '1 day' * coalesce(s.execution_attempt_retention_days, 90))
        FOR UPDATE OF a2 SKIP LOCKED
        LIMIT 500)
      RETURNING a.id`);
    const attemptFor = async (actionRowId: number): Promise<string> =>
      (await client!.query<{ total: string }>("SELECT count(*)::text AS total FROM epdr_attempts WHERE action_id = $1", [actionRowId])).rows[0]!.total;
    check("retention deletes only terminal-action attempts past the window",
      (await attemptFor(terminalAction)) === "0" && (await attemptFor(pendingAction)) === "1" && retentionDelete.rowCount === 1);

    // ---- 0087: explicit time zones -----------------------------------------
    await client.query(`INSERT INTO epdr_local_notification_policies (site_id, enabled, updated_by, time_zone)
      VALUES ($1, true, $2, 'Asia/Jakarta') ON CONFLICT (site_id) DO UPDATE SET time_zone = 'Asia/Jakarta'`,
    [siteId, userId]);
    let invalidUserZoneRejected = false;
    try { await client.query(`UPDATE users SET epdr_time_zone = 'WIB' WHERE id = $1`, [userId]); } catch { invalidUserZoneRejected = true; }
    check("0087 user timezone trigger rejects non-IANA abbreviations", invalidUserZoneRejected);
    await client.query(`UPDATE users SET epdr_time_zone = 'Asia/Makassar' WHERE id = $1`, [userId]);
    const savedUserZone = await client.query<{ epdr_time_zone: string }>(
      "SELECT epdr_time_zone FROM users WHERE id = $1", [userId]);
    check("0087 user timezone accepts named IANA zones", savedUserZone.rows[0]?.epdr_time_zone === "Asia/Makassar");
    let invalidPolicyZoneRejected = false;
    try { await client.query(`UPDATE epdr_local_notification_policies SET time_zone = '+07:00' WHERE site_id = $1`, [siteId]); } catch { invalidPolicyZoneRejected = true; }
    check("0087 policy timezone trigger rejects numeric offsets", invalidPolicyZoneRejected);

    const secondSite = await client.query<{ id: number }>(
      `INSERT INTO sites (name, code) VALUES ('EPDR verify 2', 'EPDRV2') RETURNING id`);
    const secondSiteId = secondSite.rows[0].id;
    await client.query(`INSERT INTO epdr_local_notification_outbox (site_id, recipient_id, kind, status, available_at, digest_day)
      VALUES ($1, $2, 'digest', 'queued', clock_timestamp(), '2026-02-02')`, [siteId, userId]);
    const crossSiteDigest = await client.query(`INSERT INTO epdr_local_notification_outbox (site_id, recipient_id, kind, status, available_at, digest_day)
      VALUES ($1, $2, 'digest', 'queued', clock_timestamp(), '2026-02-02')`, [secondSiteId, userId]);
    check("0087 digest dedup key includes the site", crossSiteDigest.rowCount === 1);
    let sameSiteDigestRejected = false;
    try {
      await client.query(`INSERT INTO epdr_local_notification_outbox (site_id, recipient_id, kind, status, available_at, digest_day)
        VALUES ($1, $2, 'digest', 'queued', clock_timestamp(), '2026-02-02')`, [siteId, userId]);
    } catch { sameSiteDigestRejected = true; }
    check("0087 digest remains unique per site, recipient and local day", sameSiteDigestRejected);

    // Zoned calendar grouping must not depend on the session time zone.
    await client.query("SET TimeZone = 'America/New_York'");
    const zonedDay = await client.query<{ day: string }>(`
      SELECT to_char((timestamp '2026-01-01 18:00:00' at time zone 'UTC') at time zone 'Asia/Jakarta', 'YYYY-MM-DD') AS day`);
    await client.query("SET TimeZone = 'UTC'");
    check("0087 local-calendar grouping is session-zone independent", zonedDay.rows[0]?.day === "2026-01-02");

    // ---- 0088: recommendation-only operational bindings --------------------
    const binding = await client.query<{ id: number }>(`
      INSERT INTO epdr_response_bindings (site_id, version_id, connection_id, account_revision, response, created_by)
      VALUES ($1, $2, $3, 1, 'scan', $4) RETURNING id`, [siteId, version.rows[0].id, connId, userId]);
    const bindingId = binding.rows[0].id;
    await client.query(`UPDATE epdr_response_bindings SET state = 'paused' WHERE id = $1`, [bindingId]);
    const pausedBinding = await client.query<{ state: string }>(
      "SELECT state FROM epdr_response_bindings WHERE id = $1", [bindingId]);
    check("0088 binding state is mutable without touching its pinned version", pausedBinding.rows[0]?.state === "paused");
    let bindingContentRejected = false;
    try { await client.query(`UPDATE epdr_response_bindings SET response = 'isolate' WHERE id = $1`, [bindingId]); } catch { bindingContentRejected = true; }
    check("0088 immutable binding content rejects response changes", bindingContentRejected);
    let evaluationRewindRejected = false;
    try {
      await client.query(`UPDATE epdr_response_bindings SET evaluation_after = evaluation_after - interval '1 hour' WHERE id = $1`, [bindingId]);
    } catch { evaluationRewindRejected = true; }
    check("0088 resume cutoff cannot move backwards", evaluationRewindRejected);

    const readIds = await client.query<{ id: number }>(
      `SELECT id FROM epdr_detection_read_evidence WHERE connection_id = $1 ORDER BY id LIMIT 2`, [connId]);
    const insertRecommendation = async (readEvidenceId: number, scopedSite = siteId): Promise<number> => {
      const { rows } = await client!.query<{ id: number }>(`
        INSERT INTO epdr_response_recommendations
          (site_id, binding_id, detection_id, read_evidence_id, endpoint_id, response, status, evidence)
        VALUES ($1, $2, $3, $4, $5, 'scan', 'blocked', '{"reasons":["hold"]}'::jsonb) RETURNING id`,
      [scopedSite, bindingId, detectionId, readEvidenceId, endpoint.rows[0].id]);
      return rows[0]!.id;
    };
    const firstRecommendation = await insertRecommendation(readIds.rows[0]!.id);
    const revisedRecommendation = await insertRecommendation(readIds.rows[1]!.id);
    check("0088 a later source read may append fresh immutable evidence", revisedRecommendation !== firstRecommendation);
    let duplicateRevisionRejected = false;
    try { await insertRecommendation(readIds.rows[0]!.id); } catch { duplicateRevisionRejected = true; }
    check("0088 the same binding, detection and read stays unique", duplicateRevisionRejected);
    let recommendationRewriteRejected = false;
    try {
      await client.query(`UPDATE epdr_response_recommendations SET status = 'matched' WHERE id = $1`, [firstRecommendation]);
    } catch { recommendationRewriteRejected = true; }
    check("0088 published recommendation evidence is immutable", recommendationRewriteRejected);
    let crossSiteRecommendationRejected = false;
    try { await insertRecommendation(readIds.rows[0]!.id, secondSiteId); } catch { crossSiteRecommendationRejected = true; }
    check("0088 composite tenancy rejects cross-site recommendations", crossSiteRecommendationRejected);

    const requestForLink = await client.query<{ id: number }>("SELECT id FROM epdr_actions ORDER BY id LIMIT 1");
    await client.query(`INSERT INTO epdr_response_request_links (recommendation_id, site_id, request_id)
      VALUES ($1, $2, $3)`, [firstRecommendation, siteId, requestForLink.rows[0]!.id]);
    let duplicateLinkRejected = false;
    try {
      await client.query(`INSERT INTO epdr_response_request_links (recommendation_id, site_id, request_id)
        VALUES ($1, $2, $3)`, [firstRecommendation, siteId, requestForLink.rows[0]!.id]);
    } catch { duplicateLinkRejected = true; }
    check("0088 a recommendation links to exactly one request", duplicateLinkRejected);

    // Overview aggregate: run the exact statement the dashboard uses against real columns.
    const overview = new PgDialect().sqlToQuery(overviewCountsQuery(siteId, { id: connId, accountRevision: 1 }, new Date()));
    const overviewRows = await client.query<{ total: number; threats: number; pending: number; review: number }>(overview.sql, overview.params);
    const fleetCount = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM epdr_endpoints WHERE site_id = $1 AND connection_id = $2
        AND account_revision = 1 AND removed_at IS NULL`, [siteId, connId]);
    check("overview aggregate runs on real columns and counts the full fleet",
      overviewRows.rowCount === 1 && String(overviewRows.rows[0]!.total) === fleetCount.rows[0]!.total,
      `${overviewRows.rows[0]?.total} vs ${fleetCount.rows[0]?.total}`);
  } catch (error) {
    checks.push({ name: "verification run", ok: false, detail: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
  } finally {
    try { await client?.end(); } catch { /* connection may already be closed */ }
    pg.cleanup();
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
