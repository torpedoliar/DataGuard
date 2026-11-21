"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { playbookConfigSchema } from "@/lib/epdr/playbook-config";
import { isDeepStrictEqual } from "node:util";
import { PLAYBOOK_TEMPLATES } from "@/lib/epdr/playbooks";
import { RESPONSE_BINDING_LIMIT } from "@/lib/epdr/response-store";

const bindingSchema = z.object({ versionId: z.number().int().positive(), response: z.enum(["scan", "isolate"]), confirmRecommendationOnly: z.literal(true) }).strict();
const stateSchema = z.object({ bindingId: z.number().int().positive(), state: z.enum(["active", "paused"]) }).strict();

/** Separate operational opt-in; never changes saved simulation configuration. */
export async function createEpdrResponseBinding(input: unknown) {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" as const };
  const parsed = bindingSchema.safeParse(input);
  if (!parsed.success) return { code: "invalid_input" as const };
  try {
    return await db.transaction(async (tx) => {
      const siteId = guard.activeSiteId;
      const { rows: connections } = await tx.execute<{ id: number; account_revision: number }>(sql`
        SELECT id, account_revision FROM watchguard_connections WHERE site_id = ${siteId}
          AND enabled = true AND account_id <> '' FOR UPDATE`);
      await assertReadSyncActor(tx, siteId, guard.session.userId);
      if (connections.length !== 1) return { code: "connection_unavailable" as const };
      const connection = connections[0];
      const { rows: versions } = await tx.execute<{ configuration: unknown; definition: unknown }>(sql`
        SELECT configuration, definition FROM epdr_playbook_versions WHERE id = ${parsed.data.versionId}
          AND site_id = ${siteId} AND mode = 'simulate' FOR SHARE`);
      if (!versions[0]) return { code: "invalid_version" as const };
      const config = playbookConfigSchema.safeParse(versions[0].configuration);
      if (!config.success) return { code: "invalid_version" as const };
      const template = PLAYBOOK_TEMPLATES.find((item) => item.id === config.data.templateId);
      if (!template?.previewAvailable || !isDeepStrictEqual(versions[0].definition, { schemaVersion: 1, template })) {
        return { code: "unsupported_version" as const };
      }
      const { rows: count } = await tx.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM epdr_response_bindings
        WHERE connection_id = ${connection.id} AND account_revision = ${connection.account_revision} AND state = 'active'`);
      if (count[0].count >= RESPONSE_BINDING_LIMIT) return { code: "binding_limit" as const };
      const { rows } = await tx.execute<{ id: number }>(sql`INSERT INTO epdr_response_bindings
        (site_id, version_id, connection_id, account_revision, response, created_by)
        VALUES (${siteId}, ${parsed.data.versionId}, ${connection.id}, ${connection.account_revision}, ${parsed.data.response}, ${guard.session.userId}) RETURNING id`);
      return { bindingId: rows[0].id };
    });
  } catch {
    // Revoked actors, missing migrations or DB errors never leak details to the client.
    return { code: "unavailable" as const };
  }
}

/** Resume does not reset the immutable activation cutoff or revive historical evidence. */
export async function setEpdrResponseBindingState(input: unknown) {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" as const };
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return { code: "invalid_input" as const };
  try {
    return await db.transaction(async (tx) => {
      const { rows: connections } = await tx.execute<{ id: number; account_revision: number }>(sql`
        SELECT id, account_revision FROM watchguard_connections WHERE site_id = ${guard.activeSiteId}
          AND enabled = true AND account_id <> '' FOR UPDATE`);
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const connection = connections[0];
      if (!connection) return { code: "connection_unavailable" as const };
      if (parsed.data.state === "active") {
        const { rows } = await tx.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM epdr_response_bindings
          WHERE connection_id = ${connection.id} AND account_revision = ${connection.account_revision} AND state = 'active' AND id <> ${parsed.data.bindingId}`);
        if (rows[0].count >= RESPONSE_BINDING_LIMIT) return { code: "binding_limit" as const };
      }
      const { rows } = await tx.execute(sql`UPDATE epdr_response_bindings SET state = ${parsed.data.state},
        evaluation_after = CASE WHEN state = 'paused' AND ${parsed.data.state} = 'active' THEN clock_timestamp() ELSE evaluation_after END
        WHERE id = ${parsed.data.bindingId} AND site_id = ${guard.activeSiteId} AND connection_id = ${connection.id}
          AND account_revision = ${connection.account_revision} RETURNING id`);
      return rows.length ? { ok: true as const } : { code: "not_found" as const };
    });
  } catch {
    // Revoked actors, missing migrations or DB errors never leak details to the client.
    return { code: "unavailable" as const };
  }
}

/** Site-scoped binding controls; historical connections remain visible but cannot be resumed. */
export async function getEpdrResponseBindings() {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" as const };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      // Project display fields only; configuration/definition snapshots stay server-side.
      const { rows } = await tx.execute<{
        id: number; version_id: number; response: string; state: string; account_revision: number;
        activated_at: Date; evaluation_after: Date; name: string; template_id: string; version: number;
        current_connection: boolean;
      }>(sql`SELECT b.id, b.version_id, b.response, b.state, b.account_revision,
          b.activated_at, b.evaluation_after, v.name, v.template_id, v.version,
          (c.enabled AND c.account_revision = b.account_revision) AS current_connection
        FROM epdr_response_bindings b JOIN epdr_playbook_versions v ON v.id = b.version_id AND v.site_id = b.site_id
        JOIN watchguard_connections c ON c.id = b.connection_id AND c.site_id = b.site_id
        WHERE b.site_id = ${guard.activeSiteId} ORDER BY b.id DESC LIMIT 100`);
      return { bindings: rows.map((row) => ({ ...row, activated_at: new Date(row.activated_at).toISOString(),
        evaluation_after: new Date(row.evaluation_after).toISOString() })) };
    });
  } catch {
    // Revoked actors, missing migrations or DB errors never leak details to the client.
    return { code: "unavailable" as const };
  }
}

/** Bounded immutable history, no evaluation or implicit backfill. */
export async function getEpdrResponseRecommendations(input: unknown = {}) {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { code: "forbidden" as const };
  const parsed = z.object({ beforeId: z.number().int().positive().optional() }).strict().safeParse(input);
  if (!parsed.success) return { code: "invalid_input" as const };
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      // Reasons are the only evidence field the operator needs here; full snapshots
      // (configuration, definition, read attempt) remain in the immutable server row.
      const { rows } = await tx.execute<{
        id: number; detection_id: number; endpoint_id: number | null; response: string; status: string;
        created_at: Date; reasons: unknown; request_id: number | null;
      }>(sql`SELECT r.id, r.detection_id, r.endpoint_id, r.response, r.status, r.created_at,
          r.evidence->'reasons' AS reasons, l.request_id
        FROM epdr_response_recommendations r
        LEFT JOIN epdr_response_request_links l ON l.recommendation_id = r.id AND l.site_id = r.site_id
        WHERE r.site_id = ${guard.activeSiteId} AND r.id < ${parsed.data.beforeId ?? 2147483647}
        ORDER BY r.id DESC LIMIT 50`);
      return { recommendations: rows.map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString() })) };
    });
  } catch {
    // Revoked actors, missing migrations or DB errors never leak details to the client.
    return { code: "unavailable" as const };
  }
}
