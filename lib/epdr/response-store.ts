import { sql } from "drizzle-orm";
import { db } from "@/db";
import { detectionCompleteness, type DetectionReadEvidence } from "./detection-evidence";
import { evaluateResponse, type ResponseType } from "./response-policy";
import { PLAYBOOK_FRESHNESS_MS, PLAYBOOK_TEMPLATES } from "./playbooks";
import { playbookConfigSchema } from "./playbook-config";

export const RESPONSE_BINDING_LIMIT = 20;
export const RESPONSE_EVALUATION_LIMIT = 50;
type Binding = { id: number; site_id: number; version_id: number; connection_id: number; account_revision: number; response: ResponseType; activated_at: Date; evaluation_after: Date; configuration: unknown; definition: unknown };
/** Invoked only after read publication. No provider client, actor impersonation, or execution import. */
export async function evaluateEpdrResponses(connectionId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const { rows: connections } = await tx.execute<{ site_id: number; account_revision: number; credential_revision: number }>(sql`
      SELECT site_id, account_revision, credential_revision FROM watchguard_connections
      WHERE id = ${connectionId} AND enabled = true AND account_id <> '' FOR UPDATE`);
    const connection = connections[0];
    if (!connection) return 0;
    const { rows: settings } = await tx.execute<{ updated_at: Date; ingest_enabled: boolean; threatsync_enabled: boolean }>(sql`
      SELECT updated_at, ingest_enabled, threatsync_enabled FROM epdr_site_settings WHERE site_id = ${connection.site_id} FOR SHARE`);
    const { rows: bindings } = await tx.execute<Binding>(sql`
      SELECT b.*, v.configuration, v.definition FROM epdr_response_bindings b
      JOIN epdr_playbook_versions v ON v.id = b.version_id AND v.site_id = b.site_id
      WHERE b.connection_id = ${connectionId} AND b.site_id = ${connection.site_id}
        AND b.account_revision = ${connection.account_revision} AND b.state = 'active'
      ORDER BY b.id LIMIT ${RESPONSE_BINDING_LIMIT} FOR UPDATE OF b`);
    let inserted = 0;
    const now = Date.now();
    for (const binding of bindings) {
      const config = playbookConfigSchema.parse(binding.configuration);
      const template = PLAYBOOK_TEMPLATES.find((item) => item.id === config.templateId)!;
      if (!template.previewAvailable) continue;
      const { rows: candidates } = await tx.execute<{
        id: number; endpoint_id: number | null; source: "threatsync" | "event_export"; category: string; threat_score: number | null;
        detected_at: Date; provider_id: string | null; removed_at: Date | null; is_critical: boolean | null; no_auto: boolean | null; hold: boolean;
      }>(sql`
        SELECT d.id, e.id AS endpoint_id, d.source, d.category, d.threat_score, d.detected_at,
          e.wg_device_id AS provider_id, e.removed_at, e.is_critical, e.no_auto,
          EXISTS(SELECT 1 FROM epdr_workflows w JOIN incidents i ON i.id = w.incident_id AND i.site_id = w.site_id
            WHERE w.site_id = d.site_id AND w.endpoint_id = d.endpoint_id AND i.automation_hold = true
              AND i.status IN ('Open', 'In Progress')) AS hold
        FROM epdr_detections d LEFT JOIN epdr_endpoints e ON e.id = d.endpoint_id AND e.site_id = d.site_id
          AND e.connection_id = d.connection_id AND e.account_revision = d.account_revision
        -- Resolve the LATEST read before filtering, so failure cannot fall back to old success.
        JOIN LATERAL (
          SELECT a.id, a.status, a.started_at, a.finished_at FROM epdr_detection_read_evidence a
          WHERE a.connection_id = d.connection_id AND a.account_revision = d.account_revision
            AND a.credential_revision = ${connection.credential_revision} AND a.source = d.source
          ORDER BY a.started_at DESC, a.id DESC LIMIT 1
        ) latest_read ON latest_read.status = 'completed'
          AND latest_read.started_at >= ${binding.evaluation_after} AND latest_read.finished_at >= d.detected_at
        WHERE d.site_id = ${binding.site_id} AND d.connection_id = ${connectionId} AND d.account_revision = ${binding.account_revision}
          AND d.created_at >= ${binding.evaluation_after} AND d.detected_at >= ${binding.evaluation_after}
          AND d.detected_at >= ${new Date(now - PLAYBOOK_FRESHNESS_MS)} AND d.detected_at <= ${new Date(now)}
          AND d.ignored_reason IS NULL
          AND d.source = ANY(${sql.param([...template.sources])}::text[]) AND d.category = ANY(${sql.param([...(template.categories ?? [])])}::text[])
          AND (${config.filters.source} = 'all' OR d.source = ${config.filters.source})
          AND (${config.filters.category} = 'all' OR d.category = ${config.filters.category})
          AND (${config.filters.score} = 'all' OR (${config.filters.score} = 'missing' AND d.threat_score IS NULL)
            OR (${config.filters.score} = 'range' AND d.threat_score BETWEEN ${config.filters.minScore} AND ${config.filters.maxScore}))
          AND NOT EXISTS(SELECT 1 FROM epdr_response_recommendations r WHERE r.binding_id = ${binding.id}
            AND r.detection_id = d.id AND r.read_evidence_id = latest_read.id)
        -- Never-evaluated first, then least recently evaluated. New read revisions cannot
        -- repeatedly reset the queue to the oldest 50 blocked detections.
        ORDER BY (SELECT max(r.created_at) FROM epdr_response_recommendations r
          WHERE r.binding_id = ${binding.id} AND r.detection_id = d.id) ASC NULLS FIRST, d.id
        LIMIT ${RESPONSE_EVALUATION_LIMIT}`);
      for (const detection of candidates) {
        const { rows: attempts } = await tx.execute<DetectionReadEvidence & { id: number }>(sql`
          SELECT id, connection_id AS "connectionId", account_revision AS "accountRevision", credential_revision AS "credentialRevision",
            source, status, "window", started_at AS "startedAt", finished_at AS "finishedAt", event_types AS "eventTypes",
            completed_event_types AS "completedEventTypes", settings_updated_at AS "settingsUpdatedAt"
          FROM epdr_detection_read_evidence WHERE connection_id = ${connectionId} AND account_revision = ${binding.account_revision}
            AND credential_revision = ${connection.credential_revision} AND source = ${detection.source}
          ORDER BY started_at DESC, id DESC LIMIT 1`);
        const attempt = attempts[0];
        // No implicit historical evaluation, and never use a previous successful attempt over a failed latest one.
        if (!attempt || attempt.status !== "completed" || attempt.startedAt < binding.evaluation_after || attempt.finishedAt < detection.detected_at) continue;
        const completeness = detectionCompleteness(attempt, { connectionId, accountRevision: binding.account_revision,
          credentialRevision: connection.credential_revision, source: detection.source,
          enabled: detection.source === "threatsync" ? settings[0]?.threatsync_enabled ?? true : settings[0]?.ingest_enabled ?? false,
          settingsUpdatedAt: settings[0]?.updated_at ?? null, now, maxAgeMs: PLAYBOOK_FRESHNESS_MS });
        const signal = { source: detection.source, category: detection.category, score: detection.threat_score,
          identityKnown: Boolean(detection.endpoint_id && detection.provider_id?.trim() && !detection.removed_at),
          observedAt: detection.detected_at.getTime(), ...completeness };
        const result = evaluateResponse(binding.configuration, binding.definition, binding.response, signal,
          { hold: detection.hold, critical: detection.is_critical, noAuto: detection.no_auto }, now);
        const evidence = { ...result, bindingId: binding.id, versionId: binding.version_id,
          configuration: binding.configuration, definition: binding.definition, connectionId, accountRevision: binding.account_revision,
          credentialRevision: connection.credential_revision, activationCutoff: binding.activated_at, evaluationCutoff: binding.evaluation_after,
          detectionId: detection.id, endpointId: detection.endpoint_id, providerId: detection.provider_id,
          readEvidenceId: attempt.id, readEvidence: attempt, signal, evaluatedAt: new Date(now).toISOString() };
        const saved = await tx.execute(sql`INSERT INTO epdr_response_recommendations
          (site_id, binding_id, detection_id, read_evidence_id, endpoint_id, response, status, evidence)
          VALUES (${binding.site_id}, ${binding.id}, ${detection.id}, ${attempt.id}, ${detection.endpoint_id},
            ${binding.response}, ${result.status}, ${JSON.stringify(evidence)}::jsonb)
          ON CONFLICT (binding_id, detection_id, read_evidence_id) DO NOTHING RETURNING id`);
        inserted += saved.rows.length;
      }
    }
    return inserted;
  });
}
