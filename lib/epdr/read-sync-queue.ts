import { sql } from "drizzle-orm";
import { db } from "@/db";

export type ReadSyncStatus = {
  status: "idle" | "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled" | "unavailable";
  requestId: number | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryAt: string | null;
  error: string | null;
};
export type ReadSyncRequestResult =
  | { status: "queued" | "already_pending"; requestId: number }
  | { status: "cooldown"; retryAt: string }
  | { status: "unavailable"; reason: "connection_unavailable" | "forbidden" | "internal_error" };
export const emptyReadSyncStatus = (status: "idle" | "unavailable"): ReadSyncStatus => ({
  status, requestId: null, requestedAt: null, startedAt: null, finishedAt: null, retryAt: null, error: null,
});
export type ReadSyncFence = { requestId: number; leaseToken: string };
type RequestRow = { id: number; connection_id: number; account_revision: number; lease_token: string };

type QueueTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Locks the actor/site and membership rows through publication to serialize revocation. */
export async function assertReadSyncActor(tx: QueueTransaction, siteId: number, actorId: number): Promise<void> {
  const { rows } = await tx.execute<{ role: string }>(sql`SELECT u.role FROM users u
    JOIN sites s ON s.id = ${siteId} WHERE u.id = ${actorId} AND u.is_active = true
    AND s.is_active = true FOR SHARE OF u, s`);
  if (!rows[0]) throw new Error("read_sync_actor_unavailable");
  if (rows[0].role === "superadmin") return;
  const { rows: memberships } = await tx.execute(sql`SELECT id FROM user_sites
    WHERE user_id = ${actorId} AND site_id = ${siteId} AND role_in_site = 'admin' FOR SHARE`);
  if (!memberships[0]) throw new Error("read_sync_membership_revoked");
}

/** Connection-row locking serializes enqueue/cooldown decisions across processes. */
export async function enqueueReadSync(siteId: number, actorId: number): Promise<ReadSyncRequestResult> {
  return db.transaction(async (tx) => {
    const { rows: connections } = await tx.execute<{ id: number; account_revision: number }>(sql`
      SELECT id, account_revision FROM watchguard_connections
      WHERE site_id = ${siteId} AND enabled = true AND account_id <> '' FOR UPDATE`);
    const connection = connections[0];
    if (!connection) return { status: "unavailable", reason: "connection_unavailable" };
    await assertReadSyncActor(tx, siteId, actorId);
    const { rows: pending } = await tx.execute<{ id: number }>(sql`
      SELECT id FROM epdr_read_sync_requests WHERE connection_id = ${connection.id}
      AND status IN ('queued', 'running') LIMIT 1`);
    if (pending[0]) return { status: "already_pending", requestId: pending[0].id };
    const { rows: recent } = await tx.execute<{ retry_at: string }>(sql`
      SELECT (requested_at + interval '5 minutes')::text AS retry_at FROM epdr_read_sync_requests
      WHERE connection_id = ${connection.id} AND requested_at > clock_timestamp() - interval '5 minutes'
      ORDER BY requested_at DESC LIMIT 1`);
    if (recent[0]) return { status: "cooldown", retryAt: new Date(recent[0].retry_at).toISOString() };
    const { rows } = await tx.execute<{ id: number }>(sql`
      INSERT INTO epdr_read_sync_requests (connection_id, site_id, account_revision, requested_by)
      VALUES (${connection.id}, ${siteId}, ${connection.account_revision}, ${actorId}) RETURNING id`);
    return { status: "queued", requestId: rows[0].id };
  });
}

export async function readSyncStatus(siteId: number): Promise<ReadSyncStatus> {
  const { rows } = await db.execute<{
    id: number; status: ReadSyncStatus["status"]; requested_at: Date; started_at: Date | null;
    finished_at: Date | null; retry_at: Date; error: string | null;
  }>(sql`SELECT r.id, r.status, r.requested_at, r.started_at, r.finished_at, r.error,
      r.requested_at + interval '5 minutes' AS retry_at
      FROM epdr_read_sync_requests r JOIN watchguard_connections c
        ON c.id = r.connection_id AND c.site_id = r.site_id AND c.account_revision = r.account_revision
      WHERE r.site_id = ${siteId} ORDER BY r.id DESC LIMIT 1`);
  const row = rows[0];
  if (!row) return emptyReadSyncStatus("idle");
  const iso = (value: Date | null) => value ? new Date(value).toISOString() : null;
  return { status: row.status, requestId: row.id, requestedAt: iso(row.requested_at),
    startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), retryAt: iso(row.retry_at), error: row.error };
}

export async function cancelReadSync(siteId: number): Promise<void> {
  // Lock order matches enqueue/publication: connection first, then request.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM watchguard_connections WHERE site_id = ${siteId} FOR UPDATE`);
    await tx.execute(sql`UPDATE epdr_read_sync_requests SET status = 'cancelled',
      finished_at = clock_timestamp(), lease_token = NULL, lease_until = NULL, error = 'cancelled'
      WHERE site_id = ${siteId} AND status IN ('queued', 'running')`);
  });
}

/** One bounded request per worker pass. Expired leases are reclaimed with a new fencing token. */
export async function processReadSyncQueue(
  run: (connectionId: number, fence: ReadSyncFence) => Promise<"ok" | "partial" | "skipped_locked">,
): Promise<void> {
  await db.execute(sql`UPDATE epdr_read_sync_requests r SET status = 'cancelled',
    finished_at = clock_timestamp(), lease_token = NULL, lease_until = NULL, error = 'connection_changed'
    WHERE status IN ('queued', 'running') AND NOT EXISTS (
      SELECT 1 FROM watchguard_connections c WHERE c.id = r.connection_id AND c.enabled
      AND c.account_revision = r.account_revision)
      OR (status IN ('queued', 'running') AND NOT EXISTS (
        SELECT 1 FROM users u JOIN sites s ON s.id = r.site_id
        WHERE u.id = r.requested_by AND u.is_active = true AND s.is_active = true
        AND (u.role = 'superadmin' OR EXISTS (SELECT 1 FROM user_sites m
          WHERE m.user_id = u.id AND m.site_id = r.site_id AND m.role_in_site = 'admin'))))`);
  const { rows } = await db.execute<RequestRow>(sql`
    WITH candidate AS (SELECT id FROM epdr_read_sync_requests
      WHERE (status = 'queued' AND available_at <= clock_timestamp())
      OR (status = 'running' AND lease_until < clock_timestamp())
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE epdr_read_sync_requests r SET status = 'running', lease_token = gen_random_uuid()::text,
      lease_until = clock_timestamp() + interval '10 minutes', started_at = coalesce(started_at, clock_timestamp()),
      attempts = attempts + 1 FROM candidate WHERE r.id = candidate.id RETURNING r.*`);
  const row = rows[0];
  if (!row) return;
  // Keep the same fence object throughout retrieval AND publication. Losing renewal
  // invalidates it locally too: a transient DB error must not leave the callback
  // able to publish with an otherwise still-live token.
  const fence: ReadSyncFence = { requestId: row.id, leaseToken: row.lease_token };
  let lostLease = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  const loseLease = () => {
    lostLease = true;
    fence.leaseToken = "";
  };
  const schedule = () => {
    timer = setTimeout(() => {
      renewal = renew();
    }, 60_000);
  };
  const renew = async () => {
    try {
      const { rows: renewed } = await db.execute<{ id: number }>(sql`
        UPDATE epdr_read_sync_requests SET lease_until = clock_timestamp() + interval '10 minutes'
        WHERE id = ${row.id} AND status = 'running' AND lease_token = ${row.lease_token}
          AND account_revision = ${row.account_revision} AND connection_id = ${row.connection_id}
          AND lease_until > clock_timestamp()
          AND EXISTS (SELECT 1 FROM watchguard_connections c WHERE c.id = connection_id
            AND c.site_id = epdr_read_sync_requests.site_id AND c.enabled AND c.account_id <> ''
            AND c.account_revision = epdr_read_sync_requests.account_revision)
          AND EXISTS (SELECT 1 FROM users u JOIN sites s ON s.id = epdr_read_sync_requests.site_id
            WHERE u.id = requested_by AND u.is_active = true AND s.is_active = true
            AND (u.role = 'superadmin' OR EXISTS (SELECT 1 FROM user_sites m
              WHERE m.user_id = u.id AND m.site_id = epdr_read_sync_requests.site_id AND m.role_in_site = 'admin'))))
        RETURNING id`);
      if (!renewed[0]) loseLease();
    } catch {
      loseLease();
    }
    // Recursive timeouts avoid overlapping renewals when the database is slow.
    if (!stopped && !lostLease) schedule();
  };
  let outcome: "ok" | "partial" | "skipped_locked" | "failed";
  schedule();
  try { outcome = await run(row.connection_id, fence); }
  catch { outcome = "failed"; }
  finally {
    stopped = true;
    clearTimeout(timer);
    // An in-flight renewal must settle before deciding whether success is safe.
    await renewal;
  }
  if (lostLease) return;
  await db.execute(sql`UPDATE epdr_read_sync_requests SET
    status = ${outcome === "ok" ? "succeeded" : outcome === "partial" ? "partial" : outcome === "skipped_locked" ? "queued" : "failed"},
    finished_at = CASE WHEN ${outcome === "skipped_locked"} THEN NULL ELSE clock_timestamp() END,
    available_at = clock_timestamp() + interval '1 minute', lease_token = NULL, lease_until = NULL,
    error = ${outcome === "failed" ? "endpoint_sync_failed" : outcome === "partial" ? "endpoint_sync_partial" : null}
    WHERE id = ${row.id} AND status = 'running' AND lease_token = ${row.lease_token}
      AND account_revision = ${row.account_revision} AND connection_id = ${row.connection_id}
      AND lease_until > clock_timestamp()
      AND EXISTS (SELECT 1 FROM watchguard_connections c WHERE c.id = connection_id
        AND c.site_id = epdr_read_sync_requests.site_id AND c.enabled AND c.account_id <> ''
        AND c.account_revision = epdr_read_sync_requests.account_revision)
      AND EXISTS (SELECT 1 FROM users u JOIN sites s ON s.id = epdr_read_sync_requests.site_id
        WHERE u.id = requested_by AND u.is_active = true AND s.is_active = true
        AND (u.role = 'superadmin' OR EXISTS (SELECT 1 FROM user_sites m
          WHERE m.user_id = u.id AND m.site_id = epdr_read_sync_requests.site_id AND m.role_in_site = 'admin'))))`);
}
