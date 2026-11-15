"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { handoffSeverity, incidentHandoffSchema } from "@/lib/epdr/incident-handoff";
import { calculateIncidentDueDate } from "@/lib/incidents";

export async function getEpdrHandoffOptions(): Promise<{ assignees: { id: number; name: string }[]; picGroups: { id: number; name: string }[] } | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: assignees } = await tx.execute<{ id: number; name: string }>(sql`SELECT DISTINCT u.id, u.username AS name FROM users u
        JOIN user_sites m ON m.user_id = u.id AND m.site_id = ${guard.activeSiteId}
        WHERE u.is_active = true ORDER BY name, u.id LIMIT 200`);
      const { rows: picGroups } = await tx.execute<{ id: number; name: string }>(sql`SELECT id, name FROM device_groups
        WHERE site_id = ${guard.activeSiteId} AND is_active = true ORDER BY name, id LIMIT 200`);
      return { assignees, picGroups };
    });
  } catch { return { message: "Handoff options unavailable." }; }
}

/** Deliberate local review, not playbook simulation or provider remediation. */
export async function createEpdrIncidentHandoff(input: unknown): Promise<{ incidentId: number; existing: boolean } | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = incidentHandoffSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid local handoff." };
  const value = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      const { rows: bindings } = await tx.execute<{ id: number; account_revision: number }>(sql`SELECT c.id, c.account_revision
        FROM watchguard_connections c WHERE c.site_id = ${guard.activeSiteId} AND c.enabled = true FOR UPDATE`);
      const binding = bindings[0];
      if (!binding) throw new Error("binding_unavailable");
      const { rows } = await tx.execute<{ incident_id: number | null; endpoint_id: number | null; category: string; severity: string }>(sql`
        SELECT incident_id, endpoint_id, category, severity FROM epdr_detections
        WHERE id = ${value.detectionId} AND site_id = ${guard.activeSiteId} AND connection_id = ${binding.id} AND account_revision = ${binding.account_revision} FOR UPDATE`);
      const detection = rows[0];
      if (!detection) throw new Error("detection_unavailable");
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      if (detection.incident_id !== null) {
        const { rows: linked } = await tx.execute<{ id: number }>(sql`SELECT id FROM incidents
          WHERE id = ${detection.incident_id} AND site_id = ${guard.activeSiteId} FOR SHARE`);
        if (!linked[0]) throw new Error("linked_incident_unavailable");
        return { incidentId: linked[0].id, existing: true };
      }
      if (detection.endpoint_id === null) throw new Error("endpoint_unresolved");
      const { rows: endpoints } = await tx.execute<{ id: number; device_id: number | null }>(sql`SELECT id, device_id FROM epdr_endpoints
        WHERE id = ${detection.endpoint_id} AND site_id = ${guard.activeSiteId} AND connection_id = ${binding.id} AND account_revision = ${binding.account_revision} AND removed_at IS NULL FOR SHARE`);
      if (!endpoints[0]) throw new Error("endpoint_unavailable");
      if (value.assigneeId !== null) {
        const { rows: assignees } = await tx.execute(sql`SELECT u.id FROM users u JOIN user_sites m ON m.user_id = u.id
          WHERE u.id = ${value.assigneeId} AND u.is_active = true AND m.site_id = ${guard.activeSiteId} FOR SHARE OF u, m`);
        if (!assignees[0]) throw new Error("assignee_unavailable");
      }
      if (value.picGroupId !== null) {
        const { rows: groups } = await tx.execute(sql`SELECT id FROM device_groups WHERE id = ${value.picGroupId}
          AND site_id = ${guard.activeSiteId} AND is_active = true FOR SHARE`);
        if (!groups[0]) throw new Error("pic_unavailable");
      }
      let deviceId: number | null = null;
      if (endpoints[0].device_id !== null) {
        const { rows: assets } = await tx.execute<{ id: number }>(sql`SELECT id FROM devices WHERE id = ${endpoints[0].device_id}
          AND site_id = ${guard.activeSiteId} AND is_active = true FOR SHARE`);
        if (!assets[0]) throw new Error("asset_binding_unavailable");
        deviceId = assets[0].id;
      }
      const severity = handoffSeverity(detection.severity);
      const { rows: created } = await tx.execute<{ id: number }>(sql`INSERT INTO incidents
        (site_id, device_id, epdr_endpoint_id, title, description, severity, status, source, automation_hold, created_by_id, assigned_to_id, due_date)
        VALUES (${guard.activeSiteId}, ${deviceId}, ${detection.endpoint_id}, ${`EPDR local review · detection #${value.detectionId}`},
          ${value.note}, ${severity}, 'Open', 'epdr_manual', true, ${guard.session.userId}, ${value.assigneeId}, ${calculateIncidentDueDate(severity)}) RETURNING id`);
      if (!created[0]) throw new Error("incident_not_created");
      const incidentId = created[0].id;
      await tx.execute(sql`INSERT INTO incident_updates (incident_id, author_id, update_type, note, new_status)
        VALUES (${incidentId}, ${guard.session.userId}, 'created', ${`Explicit EPDR local handoff for detection #${value.detectionId}. PIC group #${value.picGroupId ?? "unassigned"}; assignee #${value.assigneeId ?? "unassigned"}. No notification or provider command requested. ${value.note}`}, 'Open')`);
      await tx.execute(sql`INSERT INTO epdr_incident_handoffs
        (site_id, detection_id, incident_id, connection_id, account_revision, requested_by, assignee_id, pic_group_id, note)
        VALUES (${guard.activeSiteId}, ${value.detectionId}, ${incidentId}, ${binding.id}, ${binding.account_revision},
          ${guard.session.userId}, ${value.assigneeId}, ${value.picGroupId}, ${value.note})`);
      await tx.execute(sql`UPDATE epdr_detections SET incident_id = ${incidentId}
        WHERE id = ${value.detectionId} AND site_id = ${guard.activeSiteId} AND incident_id IS NULL`);
      return { incidentId, existing: false };
    });
  } catch { return { message: "Local handoff unavailable. No provider action was requested." }; }
}
