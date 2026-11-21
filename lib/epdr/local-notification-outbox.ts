import { epdrLocalClock } from "./time-zone";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { nextLocalNotificationDelivery } from "./local-notification-schedule";

export type LocalNotificationPolicy = {
  timeZone: string;
  enabled: boolean; notifyHeld: boolean; quietStart: number | null; quietEnd: number | null;
  escalateOverdueToAdmins: boolean;
  digestEnabled: boolean; digestHourUtc: number | null;
  updatedAt: string | null; updatedBy: number | null;
  channel: "local"; recipientScope: "assignee";
};
export type LocalNotificationKind = "assigned" | "overdue" | "sla_escalation" | "digest";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Claim = { id: number; site_id: number; incident_id: number | null; recipient_id: number; kind: LocalNotificationKind; lease_token: string; digest_day: string | Date | null };

/** No guessed PIC recipients: only the current assignee with an active same-site membership. */
export async function scheduleLocalNotifications(siteId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{
      site_id: number; escalate_overdue_to_admins: boolean; digest_enabled: boolean; digest_hour_utc: number | null;
    }>(sql`
      SELECT p.site_id, p.escalate_overdue_to_admins, p.digest_enabled, p.digest_hour_utc FROM epdr_local_notification_policies p
      JOIN sites s ON s.id = p.site_id AND s.is_active = true
      WHERE p.site_id = ${siteId} AND p.enabled = true FOR SHARE OF p, s`);
    if (!rows[0]) return;
    await tx.execute(sql`INSERT INTO epdr_local_notification_outbox
      (site_id, incident_id, recipient_id, kind, available_at)
      SELECT i.site_id, i.id, i.assigned_to_id, k.kind,
        CASE WHEN k.kind = 'overdue' THEN i.due_date ELSE clock_timestamp() END
      FROM incidents i JOIN epdr_local_notification_policies p ON p.site_id = i.site_id
      JOIN users u ON u.id = i.assigned_to_id AND u.is_active = true
      JOIN user_sites m ON m.user_id = u.id AND m.site_id = i.site_id
      CROSS JOIN (VALUES ('assigned'), ('overdue')) k(kind)
      WHERE i.site_id = ${siteId} AND i.source = 'epdr_manual' AND p.enabled = true
        AND (i.automation_hold = false OR p.notify_held = true)
        AND i.status IN ('Open', 'In Progress') AND (k.kind <> 'overdue' OR i.due_date IS NOT NULL)
      ON CONFLICT (incident_id, recipient_id, kind) DO NOTHING`);
    if (rows[0].escalate_overdue_to_admins) {
      // Opt-in SLA escalation goes to active site admins (never guessed PIC
      // recipients). The assignee is skipped because they already receive the
      // overdue notice; escalation is a separate local notice kind.
      await tx.execute(sql`INSERT INTO epdr_local_notification_outbox
        (site_id, incident_id, recipient_id, kind, available_at)
        SELECT i.site_id, i.id, m.user_id, 'sla_escalation', i.due_date
        FROM incidents i JOIN epdr_local_notification_policies p ON p.site_id = i.site_id
        JOIN user_sites m ON m.site_id = i.site_id AND m.role_in_site = 'admin'
        JOIN users u ON u.id = m.user_id AND u.is_active = true
        JOIN sites s ON s.id = i.site_id AND s.is_active = true
        WHERE i.site_id = ${siteId} AND i.source = 'epdr_manual' AND p.enabled = true
          AND p.escalate_overdue_to_admins = true
          AND (i.automation_hold = false OR p.notify_held = true)
          AND i.status IN ('Open', 'In Progress') AND i.due_date IS NOT NULL
          AND i.due_date <= clock_timestamp()
          AND m.user_id <> coalesce(i.assigned_to_id, -1)
        ON CONFLICT (incident_id, recipient_id, kind) DO NOTHING`);
    }
    if (rows[0].digest_enabled && rows[0].digest_hour_utc !== null) {
      // One digest per site/recipient per policy-local day, at or after the configured hour.
      // The day key makes a missed worker pass safe to retry later the same day.
      await tx.execute(sql`INSERT INTO epdr_local_notification_outbox
        (site_id, incident_id, recipient_id, kind, available_at, digest_day)
        SELECT ${siteId}, NULL, n.recipient_id, 'digest', clock_timestamp(),
          (clock_timestamp() AT TIME ZONE p.time_zone)::date
        FROM epdr_local_notifications n
        JOIN users u ON u.id = n.recipient_id AND u.is_active = true
        JOIN user_sites m ON m.user_id = u.id AND m.site_id = n.site_id
        JOIN epdr_local_notification_policies p ON p.site_id = n.site_id
        WHERE n.site_id = ${siteId} AND n.read_at IS NULL AND n.kind <> 'digest'
          AND p.enabled = true AND p.digest_enabled = true AND p.digest_hour_utc IS NOT NULL
          AND extract(hour FROM clock_timestamp() AT TIME ZONE p.time_zone) >= p.digest_hour_utc
        GROUP BY n.recipient_id, p.time_zone
        ON CONFLICT DO NOTHING`);
    }
  });
}

async function audit(tx: Transaction, row: Claim, event: string) {
  await tx.execute(sql`INSERT INTO epdr_local_notification_audit (site_id, event, incident_id, outbox_id)
    VALUES (${row.site_id}, ${event}, ${row.incident_id}, ${row.id})`);
}

/** One bounded local publication. Claims are leased; every publication is transactionally fenced. */
export async function processLocalNotificationQueue(): Promise<void> {
  // A worker dying on its final attempt must not leave an immortal running row.
  await db.execute(sql`WITH exhausted AS (
    UPDATE epdr_local_notification_outbox SET status = 'failed', finished_at = clock_timestamp(),
      lease_token = NULL, lease_until = NULL, last_error = 'attempt_limit'
    WHERE attempts >= 5 AND (status = 'queued' OR (status = 'running' AND lease_until <= clock_timestamp()))
    RETURNING id, site_id, incident_id)
    INSERT INTO epdr_local_notification_audit (site_id, event, incident_id, outbox_id)
      SELECT site_id, 'failed', incident_id, id FROM exhausted`);
  const { rows } = await db.execute<Claim>(sql`WITH candidate AS (
    SELECT id FROM epdr_local_notification_outbox WHERE attempts < 5 AND
      ((status = 'queued' AND available_at <= clock_timestamp()) OR
       (status = 'running' AND lease_until <= clock_timestamp()))
    ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE epdr_local_notification_outbox o SET status = 'running', attempts = attempts + 1,
      lease_token = gen_random_uuid()::text, lease_until = clock_timestamp() + interval '2 minutes'
    FROM candidate WHERE o.id = candidate.id RETURNING o.*`);
  const row = rows[0];
  if (!row) return;
  try {
    await db.transaction(async (tx) => {
      // Locks serialize disabling policy, closing/reassigning incidents and membership revocation.
      const { rows: policies } = await tx.execute<{
        notify_held: boolean; quiet_start: number | null; quiet_end: number | null; digest_enabled: boolean; time_zone: string; digest_hour_utc: number | null;
        escalate_overdue_to_admins: boolean;
      }>(sql`SELECT p.notify_held, p.quiet_start, p.quiet_end, p.digest_enabled, p.time_zone, p.digest_hour_utc, p.escalate_overdue_to_admins
        FROM epdr_local_notification_policies p JOIN sites s ON s.id = p.site_id
        WHERE p.site_id = ${row.site_id} AND p.enabled = true AND s.is_active = true FOR SHARE OF p, s`);
      const { rows: recipients } = await tx.execute<{ id: number; role_in_site: string }>(sql`SELECT u.id, m.role_in_site FROM users u
        JOIN user_sites m ON m.user_id = u.id AND m.site_id = ${row.site_id}
        WHERE u.id = ${row.recipient_id} AND u.is_active = true FOR SHARE OF u, m`);
      const { rows: fenced } = await tx.execute(sql`SELECT id FROM epdr_local_notification_outbox
        WHERE id = ${row.id} AND site_id = ${row.site_id} AND status = 'running'
          AND lease_token = ${row.lease_token} AND lease_until > clock_timestamp() FOR UPDATE`);
      if (!fenced[0]) return;
      const recipient = recipients[0];
      const cancel = async () => {
        await tx.execute(sql`UPDATE epdr_local_notification_outbox SET status = 'cancelled',
          finished_at = clock_timestamp(), lease_token = NULL, lease_until = NULL, last_error = 'eligibility_revoked'
          WHERE id = ${row.id}`);
        await audit(tx, row, "cancelled");
      };
      /** Shared quiet-window gate; requeues without spending an attempt and returns false. */
      const publish = async (incidentId: number | null): Promise<boolean> => {
        const { rows: clocks } = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
        const now = new Date(clocks[0].now);
        const availableAt = nextLocalNotificationDelivery(now, {
          quietStart: policies[0]?.quiet_start ?? null, quietEnd: policies[0]?.quiet_end ?? null,
          timeZone: policies[0]?.time_zone ?? "UTC",
        });
        if (row.kind === "digest") {
          const clock = epdrLocalClock(now, policies[0].time_zone ?? "UTC");
          const day = row.digest_day instanceof Date ? row.digest_day.toISOString().slice(0, 10) : row.digest_day;
          if (day !== clock.day) { await cancel(); return false; }
          // A changed digest hour must not publish an already queued row early.
          if (policies[0].digest_hour_utc === null) { await cancel(); return false; }
          if (clock.hour < policies[0].digest_hour_utc) {
            const retry = new Date(Math.floor(now.getTime() / 60000) * 60000 + 60000);
            await tx.execute(sql`UPDATE epdr_local_notification_outbox SET status = 'queued', available_at = ${retry},
              attempts = attempts - 1, lease_token = NULL, lease_until = NULL WHERE id = ${row.id}`);
            return false;
          }
        }
        if (availableAt > now) {
          await tx.execute(sql`UPDATE epdr_local_notification_outbox SET status = 'queued', available_at = ${availableAt},
            attempts = attempts - 1, lease_token = NULL, lease_until = NULL WHERE id = ${row.id}`);
          return false;
        }
        await tx.execute(sql`INSERT INTO epdr_local_notifications (outbox_id, site_id, incident_id, recipient_id, kind)
          VALUES (${row.id}, ${row.site_id}, ${incidentId}, ${row.recipient_id}, ${row.kind})
          ON CONFLICT (outbox_id) DO NOTHING`);
        await tx.execute(sql`UPDATE epdr_local_notification_outbox SET status = 'delivered', finished_at = clock_timestamp(),
          lease_token = NULL, lease_until = NULL, last_error = NULL WHERE id = ${row.id}`);
        await audit(tx, row, "delivered");
        return true;
      };

      if (row.kind === "digest") {
        if (!policies[0]?.digest_enabled || !recipient) return void await cancel();
        const { rows: unread } = await tx.execute<{ count: number }>(sql`
          SELECT count(*)::integer AS count FROM epdr_local_notifications
          WHERE site_id = ${row.site_id} AND recipient_id = ${row.recipient_id}
            AND read_at IS NULL AND kind <> 'digest'`);
        // Nothing left to summarize: cancel rather than deliver an empty digest.
        if (Number(unread[0]?.count ?? 0) === 0) return void await cancel();
        await publish(null);
        return;
      }

      const { rows: incidents } = await tx.execute<{
        automation_hold: boolean; due_date: Date | null; overdue: boolean; assigned_to_id: number | null;
      }>(sql`SELECT automation_hold, due_date, due_date <= clock_timestamp() AS overdue, assigned_to_id FROM incidents
        WHERE id = ${row.incident_id} AND site_id = ${row.site_id}
          AND source = 'epdr_manual' AND status IN ('Open', 'In Progress') FOR SHARE`);
      const incident = incidents[0];
      const deadlineKind = row.kind === "overdue" || row.kind === "sla_escalation";
      // Escalation recipients must currently be site admins; assignee notices
      // must still target the current assignee captured by the outbox row.
      const recipientEligible = Boolean(recipient) &&
        (row.kind === "sla_escalation" ? recipient.role_in_site === "admin" : incident?.assigned_to_id === row.recipient_id);
      if (!policies[0] || !incident || !recipientEligible ||
          (row.kind === "sla_escalation" && !policies[0].escalate_overdue_to_admins) ||
          (incident.automation_hold && !policies[0].notify_held) || (deadlineKind && !incident.due_date)) {
        await cancel();
        return;
      }
      // A deadline extended after scheduling must never produce an early SLA notice.
      if (deadlineKind && !incident.overdue) {
        await tx.execute(sql`UPDATE epdr_local_notification_outbox SET status = 'queued', available_at = ${incident.due_date},
          attempts = attempts - 1, lease_token = NULL, lease_until = NULL WHERE id = ${row.id}`);
        return;
      }
      await publish(row.incident_id);
    });
  } catch {
    // No error details or private content in the queue. Publication and its audit rolled back together.
    await db.transaction(async (tx) => {
      const { rows: retried } = await tx.execute<{ status: string }>(sql`UPDATE epdr_local_notification_outbox
        SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
          available_at = clock_timestamp() + interval '1 minute' * attempts,
          finished_at = CASE WHEN attempts >= 5 THEN clock_timestamp() ELSE NULL END,
          lease_token = NULL, lease_until = NULL, last_error = 'local_publication_failed'
        WHERE id = ${row.id} AND site_id = ${row.site_id} AND status = 'running'
          AND lease_token = ${row.lease_token} AND lease_until > clock_timestamp() RETURNING status`);
      if (retried[0]) await audit(tx, row, retried[0].status === "failed" ? "failed" : "retry");
    });
  }
}
