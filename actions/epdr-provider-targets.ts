"use server";

/**
 * Operator confirmation of ThreatSync provider targets.
 *
 * A `provider_sync` job records every incident/target it ingests as
 * `unreviewed`. Only a site administrator turns a target into a usable
 * execution target by confirming the endpoint it belongs to — identity is
 * never inferred, so a wrong link must pass through a human here. Rejected
 * targets stay visible for the record but can never authorize an action.
 *
 * The mislink report lists historical ThreatSync detections that kept an
 * endpoint under the retired entity-as-device fallback: their entity has no
 * confirmed target mapping to that endpoint on the current revision. History
 * is never rewritten automatically; this panel only surfaces the candidates.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";

export type ProviderTargetError = {
  code: "invalid_input" | "forbidden" | "not_found" | "state_conflict" | "endpoint_unavailable" | "service_unavailable";
};

export type ProviderTargetCandidate = {
  targetId: number;
  tsIncidentId: string;
  entityId: string;
  providerStatus: string | null;
  /** Endpoint suggested by the provider's explicit device id, when unambiguous. */
  suggestedEndpointId: number | null;
  suggestedHostName: string | null;
};

export type MislinkedDetection = {
  detectionId: number;
  tsIncidentId: string | null;
  entityId: string;
  endpointId: number;
  hostName: string | null;
};

export type ProviderTargetsData = {
  candidates: ProviderTargetCandidate[];
  mislinked: MislinkedDetection[];
  endpoints: { id: number; hostName: string | null }[];
};

function error(code: ProviderTargetError["code"]): ProviderTargetError {
  return { code };
}

/** Entity id from a threatsync source key (`ts:<incidentId>:<entityId>`). */
const ENTITY_FROM_SOURCE_KEY = sql`substring(substring(d.source_key from 4) from position(':' in substring(d.source_key from 4)) + 1)`;

export async function getEpdrProviderTargets(): Promise<ProviderTargetsData | ProviderTargetError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  try {
    const { rows: bindingRows } = await db.execute<{ id: number; account_revision: number }>(sql`
      SELECT id, account_revision FROM watchguard_connections
      WHERE site_id = ${guard.activeSiteId} AND enabled ORDER BY id ASC LIMIT 1`);
    const binding = bindingRows[0];
    if (!binding) return { candidates: [], mislinked: [], endpoints: [] };

    const { rows: candidateRows } = await db.execute<{
      target_id: number; ts_incident_id: string; entity_id: string; provider_status: string | null;
      suggested_endpoint_id: number | null; suggested_host_name: string | null;
    }>(sql`
      SELECT t.id AS target_id, p.ts_incident_id, t.entity_id, p.provider_status,
        se.id AS suggested_endpoint_id, se.host_name AS suggested_host_name
      FROM epdr_provider_incident_targets t
      JOIN epdr_provider_incidents p ON p.id = t.provider_incident_id
      LEFT JOIN epdr_endpoints se ON se.id = t.endpoint_id
        AND se.connection_id = p.connection_id AND se.account_revision = p.account_revision
        AND se.removed_at IS NULL
      WHERE p.connection_id = ${binding.id} AND p.account_revision = ${binding.account_revision}
        AND t.review_state = 'unreviewed'
      ORDER BY t.updated_at DESC, t.id DESC LIMIT 50`);

    const { rows: mislinkedRows } = await db.execute<{
      id: number; ts_incident_id: string | null; entity_id: string; endpoint_id: number; host_name: string | null;
    }>(sql`
      SELECT d.id, d.ts_incident_id, ${ENTITY_FROM_SOURCE_KEY} AS entity_id, d.endpoint_id, e.host_name
      FROM epdr_detections d
      JOIN epdr_endpoints e ON e.id = d.endpoint_id AND e.connection_id = d.connection_id
      WHERE d.connection_id = ${binding.id} AND d.account_revision = ${binding.account_revision}
        AND d.source = 'threatsync' AND d.endpoint_id IS NOT NULL
        AND d.created_at > clock_timestamp() - interval '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM epdr_provider_incident_targets t
          JOIN epdr_provider_incidents p ON p.id = t.provider_incident_id
          WHERE p.connection_id = d.connection_id AND p.account_revision = d.account_revision
            AND t.entity_id = ${ENTITY_FROM_SOURCE_KEY}
            AND t.review_state = 'confirmed' AND t.endpoint_id = d.endpoint_id)
      ORDER BY d.id DESC LIMIT 20`);

    const { rows: endpointRows } = await db.execute<{ id: number; host_name: string | null }>(sql`
      SELECT id, host_name FROM epdr_endpoints
      WHERE connection_id = ${binding.id} AND account_revision = ${binding.account_revision}
        AND removed_at IS NULL
      ORDER BY host_name ASC NULLS LAST LIMIT 200`);

    return {
      candidates: candidateRows.map((row) => ({
        targetId: row.target_id,
        tsIncidentId: row.ts_incident_id,
        entityId: row.entity_id,
        providerStatus: row.provider_status,
        suggestedEndpointId: row.suggested_endpoint_id,
        suggestedHostName: row.suggested_host_name,
      })),
      mislinked: mislinkedRows.map((row) => ({
        detectionId: row.id,
        tsIncidentId: row.ts_incident_id,
        entityId: row.entity_id,
        endpointId: row.endpoint_id,
        hostName: row.host_name,
      })),
      endpoints: endpointRows.map((row) => ({ id: row.id, hostName: row.host_name })),
    };
  } catch {
    return error("service_unavailable");
  }
}

const confirmSchema = z.object({
  targetId: z.number().int().positive(),
  endpointId: z.number().int().positive(),
}).strict();

const rejectSchema = z.object({
  targetId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(200),
}).strict();

async function auditProviderTarget(event: string, detail: Record<string, unknown> & { targetId: number }): Promise<void> {
  await logAudit({
    action: "EPDR_EXECUTION",
    entity: "provider_target",
    entityId: detail.targetId,
    entityName: event,
    detail: JSON.stringify({ event, ...detail }),
  });
}

/** Confirm the endpoint a ThreatSync entity belongs to. Never sends anything. */
export async function confirmEpdrProviderTarget(input: unknown): Promise<{ ok: true } | ProviderTargetError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");
  try {
    const outcome = await db.transaction(async (tx) => {
      const { rows } = await tx.execute<{
        entity_id: string; review_state: string; ts_incident_id: string; connection_id: number; account_revision: number;
      }>(sql`
        SELECT t.entity_id, t.review_state, p.ts_incident_id, p.connection_id, p.account_revision
        FROM epdr_provider_incident_targets t
        JOIN epdr_provider_incidents p ON p.id = t.provider_incident_id
        JOIN watchguard_connections c ON c.id = p.connection_id AND c.site_id = ${guard.activeSiteId}
          AND c.enabled AND p.account_revision = c.account_revision
        WHERE t.id = ${parsed.data.targetId}
        FOR UPDATE OF t`);
      const row = rows[0];
      if (!row) return "not_found" as const;
      if (row.review_state === "confirmed") return "state_conflict" as const;

      // The endpoint must exist, belong to this site and connection, sit on
      // the incident's own account revision, and not be removed.
      const { rows: endpoints } = await tx.execute<{ id: number }>(sql`
        SELECT e.id FROM epdr_endpoints e
        WHERE e.id = ${parsed.data.endpointId} AND e.site_id = ${guard.activeSiteId}
          AND e.connection_id = ${row.connection_id}
          AND e.account_revision = ${row.account_revision}
          AND e.removed_at IS NULL LIMIT 1`);
      if (!endpoints[0]) return "endpoint_unavailable" as const;

      const updated = await tx.execute(sql`
        UPDATE epdr_provider_incident_targets SET review_state = 'confirmed',
          endpoint_id = ${parsed.data.endpointId}, confirmed_by = ${guard.session.userId},
          confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = ${parsed.data.targetId} AND review_state <> 'confirmed'`);
      if ((updated.rowCount ?? 0) !== 1) return "state_conflict" as const;
      return { row } as const;
    });
    if (typeof outcome === "string") return error(outcome);

    await auditProviderTarget("confirm_provider_target", {
      targetId: parsed.data.targetId,
      endpointId: parsed.data.endpointId,
      entityId: outcome.row.entity_id,
      tsIncidentId: outcome.row.ts_incident_id,
    });
    return { ok: true };
  } catch {
    return error("service_unavailable");
  }
}

/** Record an operator's rejection. The target stays visible, never usable. */
export async function rejectEpdrProviderTarget(input: unknown): Promise<{ ok: true } | ProviderTargetError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return error("forbidden");
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return error("invalid_input");
  try {
    const { rows } = await db.execute<{ entity_id: string; ts_incident_id: string }>(sql`
      UPDATE epdr_provider_incident_targets t SET review_state = 'rejected',
        endpoint_id = NULL, confirmed_by = NULL, confirmed_at = NULL, updated_at = clock_timestamp()
      FROM epdr_provider_incidents p, watchguard_connections c
      WHERE p.id = t.provider_incident_id AND c.id = p.connection_id
        AND c.site_id = ${guard.activeSiteId} AND p.account_revision = c.account_revision
        AND t.id = ${parsed.data.targetId} AND t.review_state <> 'confirmed'
      RETURNING t.entity_id, p.ts_incident_id`);
    if ((rows.length ?? 0) !== 1) return error("state_conflict");
    await auditProviderTarget("reject_provider_target", {
      targetId: parsed.data.targetId,
      reason: parsed.data.reason,
      entityId: rows[0]!.entity_id,
      tsIncidentId: rows[0]!.ts_incident_id,
    });
    return { ok: true };
  } catch {
    return error("service_unavailable");
  }
}
