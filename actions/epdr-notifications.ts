"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { isValidLocalQuietWindow } from "@/lib/epdr/local-notification-schedule";
import type { LocalNotificationKind, LocalNotificationPolicy } from "@/lib/epdr/local-notification-outbox";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const policyInput = z.object({
  enabled: z.boolean(), notifyHeld: z.boolean(),
  quietStart: z.number().int().min(0).max(23).nullable(),
  quietEnd: z.number().int().min(0).max(23).nullable(),
  escalateOverdueToAdmins: z.boolean(),
  digestEnabled: z.boolean(),
  digestHourUtc: z.number().int().min(0).max(23).nullable(),
}).strict().refine(isValidLocalQuietWindow)
  .refine((value) => value.digestEnabled === (value.digestHourUtc !== null), { message: "Digest hour required." });
const readInput = z.object({ notificationId: z.number().int().positive().max(2147483647) }).strict();
const unavailable = { message: "Local notifications unavailable. No external channel is configured." };

async function assertRecipient(tx: Transaction, siteId: number, userId: number) {
  const { rows } = await tx.execute<{ role: string }>(sql`SELECT u.role FROM users u
    JOIN sites s ON s.id = ${siteId} WHERE u.id = ${userId}
      AND u.is_active = true AND s.is_active = true FOR SHARE OF u, s`);
  if (!rows[0]) throw new Error("recipient_revoked");
  if (rows[0].role === "superadmin") return true;
  const { rows: memberships } = await tx.execute<{ role_in_site: string }>(sql`SELECT role_in_site FROM user_sites
    WHERE user_id = ${userId} AND site_id = ${siteId} FOR SHARE`);
  if (!memberships[0]) throw new Error("membership_revoked");
  return memberships[0].role_in_site === "admin";
}

/** Mirror Incident creator/assignee/admin visibility, using locked current DB roles. */
function incidentVisibility(userId: number, isAdmin: boolean) {
  return sql`(${isAdmin} OR i.created_by_id = ${userId} OR i.assigned_to_id = ${userId})`;
}
/** Digest notifications have no Incident target; recipient ownership is sufficient. */
function notificationVisibility(userId: number, isAdmin: boolean) {
  return sql`(n.incident_id IS NULL OR ${incidentVisibility(userId, isAdmin)})`;
}
async function policy(tx: Transaction, siteId: number): Promise<LocalNotificationPolicy> {
  const { rows } = await tx.execute<{ enabled: boolean; notify_held: boolean; quiet_start: number | null;
    quiet_end: number | null; escalate_overdue_to_admins: boolean; digest_enabled: boolean;
    digest_hour_utc: number | null; updated_at: Date; updated_by: number }>(sql`
    SELECT enabled, notify_held, quiet_start, quiet_end, escalate_overdue_to_admins, digest_enabled, digest_hour_utc,
      updated_at, updated_by FROM epdr_local_notification_policies WHERE site_id = ${siteId}`);
  return { enabled: rows[0]?.enabled ?? false, notifyHeld: rows[0]?.notify_held ?? false,
    quietStart: rows[0]?.quiet_start ?? null, quietEnd: rows[0]?.quiet_end ?? null,
    escalateOverdueToAdmins: rows[0]?.escalate_overdue_to_admins ?? false,
    digestEnabled: rows[0]?.digest_enabled ?? false, digestHourUtc: rows[0]?.digest_hour_utc ?? null,
    updatedAt: rows[0] ? new Date(rows[0].updated_at).toISOString() : null,
    updatedBy: rows[0]?.updated_by ?? null, channel: "local", recipientScope: "assignee" };
}

export async function getEpdrNotificationPolicy(): Promise<LocalNotificationPolicy | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      return policy(tx, guard.activeSiteId);
    });
  } catch { return unavailable; }
}

export async function setEpdrNotificationPolicy(input: unknown): Promise<LocalNotificationPolicy | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = policyInput.safeParse(input);
  if (!parsed.success) return { message: "Invalid local notification policy." };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      await tx.execute(sql`INSERT INTO epdr_local_notification_policies
        (site_id, enabled, notify_held, quiet_start, quiet_end, escalate_overdue_to_admins,
         digest_enabled, digest_hour_utc, updated_by)
        VALUES (${guard.activeSiteId}, ${parsed.data.enabled}, ${parsed.data.notifyHeld}, ${parsed.data.quietStart},
          ${parsed.data.quietEnd}, ${parsed.data.escalateOverdueToAdmins}, ${parsed.data.digestEnabled},
          ${parsed.data.digestHourUtc}, ${guard.session.userId})
        ON CONFLICT (site_id) DO UPDATE SET enabled = EXCLUDED.enabled, notify_held = EXCLUDED.notify_held,
          quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
          escalate_overdue_to_admins = EXCLUDED.escalate_overdue_to_admins,
          digest_enabled = EXCLUDED.digest_enabled, digest_hour_utc = EXCLUDED.digest_hour_utc,
          updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()`);
      await tx.execute(sql`INSERT INTO epdr_local_notification_audit (site_id, actor_id, event)
        VALUES (${guard.activeSiteId}, ${guard.session.userId}, 'policy_changed')`);
      return policy(tx, guard.activeSiteId);
    });
  } catch { return unavailable; }
}

export type EpdrNotificationDigest = {
  assigned: number; overdue: number; incidents: number;
};

export async function getEpdrNotificationInbox(): Promise<{
  notifications: { id: number; incidentId: number | null; kind: LocalNotificationKind; createdAt: string; readAt: string | null }[];
  unreadCount: number;
  /** Read-only grouping of current unread notices; an opt-in digest notification may also be queued. */
  digest: EpdrNotificationDigest;
} | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  try {
    return await db.transaction(async (tx) => {
      const isAdmin = await assertRecipient(tx, guard.activeSiteId, guard.session.userId);
      const visible = notificationVisibility(guard.session.userId, isAdmin);
      const { rows } = await tx.execute<{ id: number; incident_id: number | null; kind: LocalNotificationKind; created_at: Date; read_at: Date | null }>(sql`
        SELECT n.id, n.incident_id, n.kind, n.created_at, n.read_at FROM epdr_local_notifications n
        LEFT JOIN incidents i ON i.id = n.incident_id AND i.site_id = n.site_id
        WHERE n.site_id = ${guard.activeSiteId} AND n.recipient_id = ${guard.session.userId} AND ${visible}
        ORDER BY n.id DESC LIMIT 100`);
      const { rows: counts } = await tx.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM epdr_local_notifications n
        LEFT JOIN incidents i ON i.id = n.incident_id AND i.site_id = n.site_id
        WHERE n.site_id = ${guard.activeSiteId} AND n.recipient_id = ${guard.session.userId} AND ${visible} AND n.read_at IS NULL`);
      const { rows: kinds } = await tx.execute<{ kind: LocalNotificationKind; count: number }>(sql`
        SELECT n.kind, count(*)::integer AS count FROM epdr_local_notifications n
        LEFT JOIN incidents i ON i.id = n.incident_id AND i.site_id = n.site_id
        WHERE n.site_id = ${guard.activeSiteId} AND n.recipient_id = ${guard.session.userId} AND ${visible} AND n.read_at IS NULL
        GROUP BY n.kind`);
      const { rows: digestIncidents } = await tx.execute<{ incidents: number }>(sql`
        SELECT count(DISTINCT n.incident_id)::integer AS incidents FROM epdr_local_notifications n
        LEFT JOIN incidents i ON i.id = n.incident_id AND i.site_id = n.site_id
        WHERE n.site_id = ${guard.activeSiteId} AND n.recipient_id = ${guard.session.userId} AND ${visible} AND n.read_at IS NULL`);
      const digest: EpdrNotificationDigest = {
        assigned: Number(kinds.find((row) => row.kind === "assigned")?.count ?? 0),
        overdue: Number(kinds.find((row) => row.kind === "overdue")?.count ?? 0),
        incidents: Number(digestIncidents[0]?.incidents ?? 0),
      };
      return { notifications: rows.map((row) => ({ id: row.id, incidentId: row.incident_id, kind: row.kind,
        createdAt: new Date(row.created_at).toISOString(), readAt: row.read_at ? new Date(row.read_at).toISOString() : null })),
      unreadCount: counts[0]?.count ?? 0, digest };
    });
  } catch { return unavailable; }
}

export async function markEpdrNotificationRead(input: unknown): Promise<{ success: true } | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = readInput.safeParse(input);
  if (!parsed.success) return { message: "Invalid notification." };
  try {
    return await db.transaction(async (tx) => {
      const isAdmin = await assertRecipient(tx, guard.activeSiteId, guard.session.userId);
      const visible = notificationVisibility(guard.session.userId, isAdmin);
      const { rows } = await tx.execute<{ incident_id: number | null; outbox_id: number }>(sql`UPDATE epdr_local_notifications n
        SET read_at = clock_timestamp() WHERE n.id = ${parsed.data.notificationId}
          AND n.site_id = ${guard.activeSiteId} AND n.recipient_id = ${guard.session.userId} AND n.read_at IS NULL
          AND (n.incident_id IS NULL OR EXISTS (SELECT 1 FROM incidents i WHERE i.id = n.incident_id AND i.site_id = n.site_id AND ${visible}))
        RETURNING incident_id, outbox_id`);
      if (rows[0]) await tx.execute(sql`INSERT INTO epdr_local_notification_audit (site_id, actor_id, event, incident_id, outbox_id)
        VALUES (${guard.activeSiteId}, ${guard.session.userId}, 'read', ${rows[0].incident_id}, ${rows[0].outbox_id})`);
      return { success: true };
    });
  } catch { return unavailable; }
}
