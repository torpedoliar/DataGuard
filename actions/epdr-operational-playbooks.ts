"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { evaluateOperationalPlaybook, OPERATIONAL_TEMPLATES, storedIntegrationOk, type OperationalEvidence, type OperationalResult, type OperationalTemplate } from "@/lib/epdr/operational-playbooks";

export type OperationalPreview = {
  sampledAt: string; limit: 100; truncated: boolean;
  rows: { source: OperationalEvidence["source"]; id: number; evaluations: { templateId: OperationalTemplate; result: OperationalResult }[] }[];
};
type StoredEvidence = Omit<OperationalEvidence, "observedAt" | "lastConnectionAt" | "dueAt"> & {
  observedAt: Date | string | null; lastConnectionAt?: Date | string | null; dueAt?: Date | string | null; testResult?: unknown;
};
const timestamp = (value: Date | string | null | undefined) => value == null ? null : new Date(value).getTime();

/** One bounded stored sample; never schedules work, writes records or calls a provider. */
export async function previewEpdrOperationalPlaybooks(): Promise<OperationalPreview | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  try {
    return await db.transaction(async (tx) => {
      // Lock the binding before actor verification, matching connection reconfiguration ordering.
      const { rows: bindings } = await tx.execute<{ id: number; account_revision: number }>(sql`
        SELECT id, account_revision FROM watchguard_connections
        WHERE site_id = ${guard.activeSiteId} AND enabled = true AND length(trim(account_id)) > 0 FOR SHARE`);
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const binding = bindings[0];
      if (!binding) return { message: "Operational preview unavailable." };
      const now = Date.now();
      const { rows } = await tx.execute<StoredEvidence>(sql`
        WITH current_endpoints AS (
          SELECT e.* FROM epdr_endpoints e JOIN watchguard_connections c
            ON c.id = e.connection_id AND c.site_id = e.site_id AND c.account_revision = e.account_revision
          WHERE e.site_id = ${guard.activeSiteId} AND c.id = ${binding.id}
            AND c.account_revision = ${binding.account_revision} AND c.enabled = true AND e.removed_at IS NULL
        ), evidence AS (
          SELECT 'endpoint' AS source, e.id, e.last_synced_at AS "observedAt",
            length(trim(e.wg_device_id)) > 0 AS "identityKnown",
            e.accumulated_protection_status AS protection, e.protection_engine_update_status AS "engineUpdate",
            e.knowledge_catalog_update_status AS "catalogUpdate", e.reboot_requested AS "rebootRequested",
            e.last_connection_at AS "lastConnectionAt", NULL::jsonb AS "testResult",
            NULL::text AS "incidentStatus", NULL::timestamp AS "dueAt"
          FROM current_endpoints e
          UNION ALL
          SELECT 'connection', c.id,
            CASE WHEN c.last_test_at >= c.updated_at THEN c.last_test_at ELSE NULL END,
            true, NULL, NULL, NULL, NULL, NULL, c.last_test_result, NULL, NULL
          FROM watchguard_connections c WHERE c.id = ${binding.id} AND c.site_id = ${guard.activeSiteId}
            AND c.account_revision = ${binding.account_revision} AND c.enabled = true
          UNION ALL
          SELECT 'incident', i.id, i.updated_at, length(trim(e.wg_device_id)) > 0,
            NULL, NULL, NULL, NULL, NULL, NULL, i.status::text, i.due_date
          FROM incidents i JOIN current_endpoints e ON e.id = i.epdr_endpoint_id AND e.site_id = i.site_id
          WHERE i.site_id = ${guard.activeSiteId}
        ) SELECT * FROM evidence ORDER BY "observedAt" DESC NULLS LAST, source, id DESC LIMIT 101`);
      return {
        sampledAt: new Date(now).toISOString(), limit: 100 as const, truncated: rows.length > 100,
        rows: rows.slice(0, 100).map((row) => {
          const evidence: OperationalEvidence = { ...row, observedAt: timestamp(row.observedAt), lastConnectionAt: timestamp(row.lastConnectionAt), dueAt: timestamp(row.dueAt), integrationOk: storedIntegrationOk(row.testResult) };
          return { source: row.source, id: row.id, evaluations: OPERATIONAL_TEMPLATES.map((templateId) => ({ templateId, result: evaluateOperationalPlaybook(templateId, evidence, now) })) };
        }),
      };
    });
  } catch { return { message: "Operational preview unavailable." }; }
}
