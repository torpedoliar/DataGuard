"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { runLocalPlaybook, type LocalStep } from "@/lib/epdr/local-playbook-engine";
import { evaluateLocalResponsePolicy, planLocalResponse, type LocalResponsePolicy } from "@/lib/epdr/local-response-policy";
import { detectionCompleteness, type DetectionReadEvidence } from "@/lib/epdr/detection-evidence";
import { PLAYBOOK_FRESHNESS_MS } from "@/lib/epdr/playbooks";
import { evaluatePlaybook } from "@/lib/epdr/playbooks";
import { playbookConfigMatches, type PlaybookConfig } from "@/lib/epdr/playbook-config";
import { classifyPlaybookVersion } from "@/lib/epdr/playbook-version";
import { describeWorkerError } from "@/lib/epdr/worker-pass";

export type LocalPlaybookReviewEvidence = {
  mode: "local"; requestedBy: number; siteId: number; versionId: number; detectionId: number;
  connectionId: number; accountRevision: number; capturedAt: string;
  configuration: unknown; definition: unknown;
  signal: Parameters<typeof planLocalResponse>[2];
  eligibility: ReturnType<typeof planLocalResponse>["eligibility"];
  responsePolicy: LocalResponsePolicy;
  // Capability contract (lib/epdr/local-capabilities.ts): kept explicit on
  // every evidence record so a future reader cannot mistake a local review
  // for a delivery receipt. `providerLocked` is load-bearing: the local
  // approval action refuses evidence without it.
  providerLocked: true; notificationsEnabled: false; automationDelivered: false;
  providerAction: "suppressed"; notification: "disabled"; incidentHandoff: "required";
};

const startSchema = z.object({ versionId: z.number().int().positive(), detectionId: z.number().int().positive(), mode: z.literal("local"), confirmLocalReview: z.literal(true) }).strict();
const runsInputSchema = z.object({ page: z.number().int().min(1).max(10_000).optional() }).strict();
const LOCAL_RUN_PAGE_SIZE = 50;
const idSchema = z.number().int().positive();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RunRow = { id: number; version_id: number; detection_id: number; requested_by: number | null; status: "pending" | "running" | "finished"; generation: number; evidence: unknown; account_revision: number; created_at: Date; finished_at: Date | null };
export type LocalPlaybookRunDetail = {
  id: number; versionId: number; detectionId: number; mode: "local"; status: RunRow["status"];
  accountRevision: number; evidence: unknown; createdAt: string; finishedAt: string | null;
  steps: (LocalStep & { reason: string | null; finishedAt: string | null })[];
};
export type LocalPlaybookError = {
  code: "invalid_input" | "binding_unavailable" | "version_unavailable" | "detection_unavailable"
    | "version_definition_changed" | "detection_outside_configuration" | "detection_outside_template"
    | "service_unavailable";
  /** Retained as a generic non-sensitive discriminator for existing clients; use code for handling. */
  message: "Local playbook unavailable.";
};
function localPlaybookError(code: LocalPlaybookError["code"]): LocalPlaybookError {
  return { code, message: "Local playbook unavailable." };
}
const unavailable = { message: "Local playbook unavailable. No notification or provider action was requested." };
const LOCAL_OPTION_LIMIT = 100;
const optionsInputSchema = z.object({
  detectionId: z.number().int().positive().optional(),
  versionId: z.number().int().positive().optional(),
}).strict();

/** Compatibility reason for a saved version, from the shared classifier. */
export type PlaybookVersionOption = {
  id: number; templateId: string | null; name: string; version: number; createdAt: string;
  compatible: boolean;
  incompatibilityReason: "invalid_configuration" | "unknown_template" | "definition_changed" | null;
  filters: PlaybookConfig["filters"] | null;
};

/** Read-only pre-create eligibility for the requested detection+version pair. */
export type LocalPlaybookEligibility = {
  versionCompatible: boolean;
  incompatibilityReason: PlaybookVersionOption["incompatibilityReason"];
  /** Why a run cannot be created right now, using the engine's own vocabulary. */
  blocker: "version_definition_changed" | "detection_outside_configuration" | "detection_outside_template"
    | "version_unavailable" | "detection_unavailable" | null;
  policy: { status: "proposed" | "blocked"; reasons: string[]; route: string | null } | null;
  endpointFacts: {
    identityKnown: boolean;
    endpointRemoved: boolean | null;
    hold: boolean;
    critical: boolean | null;
    noAuto: boolean | null;
    sourceCompleteness: "verified" | "partial" | "unknown";
    fresh: boolean;
  } | null;
};

export type LocalPlaybookOptions = {
  versions: PlaybookVersionOption[];
  versionsTruncated: boolean;
  detections: { id: number; hostName: string | null; category: string; threatName: string | null; score: number | null; detectedAt: string }[];
  detectionTruncated: boolean;
  requestedDetection: LocalPlaybookOptions["detections"][number] | null;
  requestedDetectionUnavailable: boolean;
  eligibility: LocalPlaybookEligibility | null;
};
type LocalDetectionRow = { id: number; host_name: string | null; category: string; threat_name: string | null; score: number | null; detected_at: Date };
function localDetectionOption(row: LocalDetectionRow): LocalPlaybookOptions["detections"][number] {
  return { id: row.id, hostName: row.host_name, category: row.category, threatName: row.threat_name,
    score: row.score, detectedAt: new Date(row.detected_at).toISOString() };
}

/**
 * Everything a local review decision needs from trusted state, read-only.
 * Extracted from the start path so the options action can compute eligibility
 * WITHOUT creating a run.
 */
async function loadLocalReviewContext(
  tx: Tx,
  siteId: number,
  binding: { id: number; account_revision: number; credential_revision: number },
  detectionId: number,
) {
  const { rows: detections } = await tx.execute<{
    source: string; category: string; score: number | null; detected_at: Date; endpoint_id: number | null;
    identity_known: boolean; endpoint_removed: boolean | null; automation_hold: boolean;
    is_critical: boolean | null; no_auto: boolean | null;
  }>(sql`
    SELECT d.source, d.category, d.threat_score AS score, d.detected_at, d.endpoint_id,
      (e.id IS NOT NULL AND length(trim(e.wg_device_id)) > 0) AS identity_known,
      CASE WHEN e.id IS NULL THEN NULL ELSE (e.removed_at IS NOT NULL) END AS endpoint_removed,
      coalesce(i.automation_hold, false) AS automation_hold,
      CASE WHEN e.id IS NULL OR e.removed_at IS NOT NULL THEN NULL
        ELSE (e.is_critical OR coalesce(a.is_critical, false)) END AS is_critical,
      CASE WHEN e.id IS NULL OR e.removed_at IS NOT NULL THEN NULL ELSE e.no_auto END AS no_auto
    FROM epdr_detections d LEFT JOIN epdr_endpoints e ON e.id = d.endpoint_id AND e.site_id = d.site_id AND e.connection_id = d.connection_id
      AND e.account_revision = d.account_revision AND e.account_revision = ${binding.account_revision}
    LEFT JOIN devices a ON a.id = e.device_id AND a.site_id = d.site_id
    LEFT JOIN incidents i ON i.id = d.incident_id AND i.site_id = d.site_id
    WHERE d.id = ${detectionId} AND d.site_id = ${siteId} AND d.connection_id = ${binding.id}
      AND d.account_revision = ${binding.account_revision} FOR SHARE OF d`);
  const detection = detections[0];
  if (!detection) return null;
  const { rows: settingsRows } = await tx.execute<{ updated_at: Date | null; threatsync_enabled: boolean; ingest_enabled: boolean }>(sql`
    SELECT updated_at, threatsync_enabled, ingest_enabled FROM epdr_site_settings WHERE site_id = ${siteId} FOR SHARE`);
  const settings = settingsRows[0];
  const { rows: attempts } = await tx.execute<DetectionReadEvidence>(sql`
    SELECT connection_id AS "connectionId", account_revision AS "accountRevision", credential_revision AS "credentialRevision",
      source, status, "window", settings_updated_at AS "settingsUpdatedAt", started_at AS "startedAt", finished_at AS "finishedAt",
      event_types AS "eventTypes", completed_event_types AS "completedEventTypes"
    FROM epdr_detection_read_evidence WHERE connection_id = ${binding.id} AND account_revision = ${binding.account_revision}
      AND credential_revision = ${binding.credential_revision} AND source = ${detection.source}
    ORDER BY started_at DESC, id DESC LIMIT 1`);
  return { detection, settings, readEvidence: attempts[0] ?? null };
}

/** Build the immutable signal + endpoint flags the response policy evaluates. */
function buildLocalSignal(
  context: NonNullable<Awaited<ReturnType<typeof loadLocalReviewContext>>>,
  binding: { id: number; account_revision: number; credential_revision: number },
  now: Date,
): { signal: Parameters<typeof planLocalResponse>[2]; flags: { hold: boolean; critical: boolean | null; noAuto: boolean | null } } {
  const source = context.detection.source;
  const readEvidence = source === "threatsync" || source === "event_export" ? detectionCompleteness(context.readEvidence, {
    connectionId: binding.id, accountRevision: binding.account_revision, credentialRevision: binding.credential_revision, source,
    enabled: source === "threatsync" ? (context.settings?.threatsync_enabled ?? true) : (context.settings?.ingest_enabled ?? false),
    settingsUpdatedAt: context.settings?.updated_at ?? null, now: now.getTime(), maxAgeMs: PLAYBOOK_FRESHNESS_MS,
  }) : { completeness: { source, status: "unknown" as const }, syncedAt: null };
  const signal = { source, category: context.detection.category, score: context.detection.score,
    identityKnown: context.detection.identity_known, observedAt: new Date(context.detection.detected_at).getTime(), ...readEvidence };
  // Only the actual linked same-site Incident can contribute a hold; absent means no hold.
  // Missing/removed endpoint identity still leaves endpoint flags unknown, never false.
  const flags = { hold: context.detection.automation_hold ?? false,
    critical: signal.identityKnown ? (context.detection.is_critical ?? null) : null,
    noAuto: signal.identityKnown ? (context.detection.no_auto ?? null) : null };
  return { signal, flags };
}

/** Named choices from current local evidence; never authorization or a run request. */
export async function getEpdrLocalPlaybookOptions(input: unknown = {}): Promise<LocalPlaybookOptions | LocalPlaybookError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return localPlaybookError("binding_unavailable");
  const parsed = optionsInputSchema.safeParse(input);
  if (!parsed.success) return localPlaybookError("invalid_input");
  try {
    return await db.transaction(async (tx) => {
      const { rows: bindings } = await tx.execute<{ id: number; account_revision: number; credential_revision: number }>(sql`
        SELECT id, account_revision, credential_revision FROM watchguard_connections
        WHERE site_id = ${guard.activeSiteId} AND enabled = true AND account_id <> ''`);
      const binding = bindings[0];
      if (!binding) return localPlaybookError("binding_unavailable");
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: versions } = await tx.execute<{ id: number; configuration: unknown; definition: unknown; version: number; created_at: Date }>(sql`
        SELECT id, configuration, definition, version, created_at FROM epdr_playbook_versions
        WHERE site_id = ${guard.activeSiteId} AND mode = 'simulate' AND name <> ''
        ORDER BY id DESC LIMIT ${LOCAL_OPTION_LIMIT + 1}`);
      const versionsTruncated = versions.length > LOCAL_OPTION_LIMIT;
      const optionsVersions: PlaybookVersionOption[] = versions.slice(0, LOCAL_OPTION_LIMIT).map((row) => {
        const classified = classifyPlaybookVersion(row.configuration, row.definition);
        return classified.compatible
          ? { id: row.id, templateId: classified.template.id, name: classified.config.name, version: row.version,
              createdAt: new Date(row.created_at).toISOString(), compatible: true, incompatibilityReason: null,
              filters: classified.config.filters }
          : { id: row.id, templateId: null, name: typeof (row.configuration as { name?: unknown } | null)?.name === "string"
              ? String((row.configuration as { name: string }).name) : "", version: row.version,
              createdAt: new Date(row.created_at).toISOString(), compatible: false,
              incompatibilityReason: classified.reason, filters: null };
      });

      const detectionFields = sql`d.id, coalesce(e.host_name, devices.name) AS host_name, d.category,
        d.threat_name, d.threat_score AS score, d.detected_at`;
      const currentDetectionScope = sql`d.site_id = ${guard.activeSiteId} AND d.connection_id = ${binding.id}
        AND d.account_revision = ${binding.account_revision} AND d.ignored_reason IS NULL`;
      const detectionJoins = sql`LEFT JOIN epdr_endpoints e ON e.id = d.endpoint_id AND e.site_id = d.site_id
        AND e.connection_id = d.connection_id AND e.account_revision = d.account_revision
        LEFT JOIN devices ON devices.id = e.device_id AND devices.site_id = d.site_id`;
      const { rows: detections } = await tx.execute<LocalDetectionRow>(sql`
        SELECT ${detectionFields} FROM epdr_detections d ${detectionJoins}
        WHERE ${currentDetectionScope}
        ORDER BY d.detected_at DESC, d.id DESC LIMIT ${LOCAL_OPTION_LIMIT + 1}`);
      const bounded = detections.slice(0, LOCAL_OPTION_LIMIT);
      const requested = parsed.data.detectionId;
      let requestedRow = bounded.find((row) => row.id === requested);
      if (requested !== undefined && !requestedRow) {
        const { rows } = await tx.execute<LocalDetectionRow>(sql`
          SELECT ${detectionFields} FROM epdr_detections d ${detectionJoins}
          WHERE ${currentDetectionScope} AND d.id = ${requested} LIMIT 1`);
        requestedRow = rows[0];
      }

      // Pre-create eligibility: read-only recompute of exactly what a start
      // would evaluate, without creating a run.
      let eligibility: LocalPlaybookEligibility | null = null;
      const { detectionId, versionId } = parsed.data;
      if (detectionId !== undefined && versionId !== undefined) {
        const { rows: versionRows } = await tx.execute<{ configuration: unknown; definition: unknown }>(sql`
          SELECT configuration, definition FROM epdr_playbook_versions
          WHERE id = ${versionId} AND site_id = ${guard.activeSiteId} AND mode = 'simulate' FOR SHARE`);
        const classified = versionRows[0] ? classifyPlaybookVersion(versionRows[0].configuration, versionRows[0].definition) : null;
        const context = await loadLocalReviewContext(tx, guard.activeSiteId, binding, detectionId);
        if (classified === null) {
          eligibility = { versionCompatible: false, incompatibilityReason: null,
            blocker: "version_unavailable", policy: null, endpointFacts: null };
        } else if (!classified.compatible) {
          eligibility = { versionCompatible: false, incompatibilityReason: classified.reason,
            blocker: classified.reason === "definition_changed" ? "version_definition_changed" : null,
            policy: null, endpointFacts: null };
        } else if (!context) {
          eligibility = { versionCompatible: true, incompatibilityReason: null,
            blocker: "detection_unavailable", policy: null, endpointFacts: null };
        } else {
          const now = new Date();
          const { signal, flags } = buildLocalSignal(context, binding, now);
          const eligibilityCheck = evaluatePlaybook(classified.template, signal, now.getTime());
          const blocker: LocalPlaybookEligibility["blocker"] =
            !playbookConfigMatches(classified.config, signal) ? "detection_outside_configuration"
            : eligibilityCheck.status === "no_match" || eligibilityCheck.reason === "unsupported"
              ? "detection_outside_template" : null;
          const policy = evaluateLocalResponsePolicy(signal, flags, now.getTime());
          eligibility = {
            versionCompatible: true,
            incompatibilityReason: null,
            blocker,
            policy: { status: policy.status, reasons: [...policy.reasons], route: policy.route },
            endpointFacts: {
              identityKnown: context.detection.identity_known,
              endpointRemoved: context.detection.endpoint_removed,
              hold: flags.hold,
              critical: flags.critical,
              noAuto: flags.noAuto,
              sourceCompleteness: signal.completeness.status,
              fresh: signal.syncedAt !== null && now.getTime() - signal.syncedAt <= PLAYBOOK_FRESHNESS_MS,
            },
          };
        }
      }

      return { versions: optionsVersions, versionsTruncated,
        detections: bounded.map(localDetectionOption),
        detectionTruncated: detections.length > LOCAL_OPTION_LIMIT,
        requestedDetection: requestedRow ? localDetectionOption(requestedRow) : null,
        requestedDetectionUnavailable: requested !== undefined && !requestedRow,
        eligibility };
    });
  } catch (error) {
    console.error(`[epdr-local-playbooks] options failed (${describeWorkerError(error)})`);
    return localPlaybookError("service_unavailable");
  }
}

/** No activation: append a distinct local review, never mutate a saved simulation or its runs. */
export async function startEpdrLocalPlaybook(input: unknown): Promise<{ runId: number; existing: boolean } | LocalPlaybookError> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return localPlaybookError("binding_unavailable");
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return localPlaybookError("invalid_input");
  const { versionId, detectionId } = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      const { rows: bindings } = await tx.execute<{ id: number; account_revision: number; credential_revision: number }>(sql`SELECT id, account_revision, credential_revision
        FROM watchguard_connections WHERE site_id = ${guard.activeSiteId} AND enabled = true AND account_id <> '' FOR UPDATE`);
      const binding = bindings[0];
      if (!binding) throw new Error("binding_unavailable");
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: versions } = await tx.execute<{ configuration: unknown; definition: unknown }>(sql`SELECT configuration, definition
        FROM epdr_playbook_versions WHERE id = ${versionId} AND site_id = ${guard.activeSiteId} AND mode = 'simulate' FOR SHARE`);
      if (!versions[0]) throw new Error("version_unavailable");
      // Shared read-only context with the options eligibility path: both
      // answers are computed from exactly the same facts.
      const context = await loadLocalReviewContext(tx, guard.activeSiteId, binding, detectionId);
      if (!context) throw new Error("detection_unavailable");
      const { rows: existing } = await tx.execute<{ id: number }>(sql`SELECT id FROM epdr_local_playbook_runs
        WHERE site_id = ${guard.activeSiteId} AND version_id = ${versionId} AND detection_id = ${detectionId}`);
      if (existing[0]) return { runId: existing[0].id, existing: true };
      const now = new Date();
      const { signal, flags } = buildLocalSignal(context, binding, now);
      const plan = planLocalResponse(versions[0].configuration, versions[0].definition, signal, flags, now.getTime());
      const evidence: LocalPlaybookReviewEvidence = { mode: "local", requestedBy: guard.session.userId, siteId: guard.activeSiteId, versionId, detectionId,
        connectionId: binding.id, accountRevision: binding.account_revision, capturedAt: now.toISOString(),
        configuration: versions[0].configuration, definition: versions[0].definition, signal, eligibility: plan.eligibility,
        responsePolicy: plan.responsePolicy,
        providerLocked: true, notificationsEnabled: false, automationDelivered: false,
        providerAction: "suppressed", notification: "disabled", incidentHandoff: "required" };
      const { rows } = await tx.execute<{ id: number }>(sql`INSERT INTO epdr_local_playbook_runs
        (site_id, version_id, detection_id, connection_id, account_revision, requested_by, evidence)
        VALUES (${guard.activeSiteId}, ${versionId}, ${detectionId}, ${binding.id}, ${binding.account_revision}, ${guard.session.userId}, ${JSON.stringify(evidence)}::jsonb)
        RETURNING id`);
      const runId = rows[0].id;
      for (const step of plan.steps) await tx.execute(sql`INSERT INTO epdr_local_playbook_steps (site_id, run_id, ordinal, kind, action)
        VALUES (${guard.activeSiteId}, ${runId}, ${step.ordinal}, ${step.kind}, ${step.action})`);
      return { runId, existing: false };
    });
  } catch (error) {
    if (error instanceof Error) {
      // The engine's own mismatch vocabulary surfaces as actionable codes,
      // not as a generic service failure.
      if (error.message === "version_definition_changed" || error.message === "detection_outside_configuration"
        || error.message === "detection_outside_template" || error.message === "invalid_input") {
        return localPlaybookError(error.message as LocalPlaybookError["code"]);
      }
      if (error.message === "binding_unavailable" || error.message === "version_unavailable" || error.message === "detection_unavailable") {
        return localPlaybookError(error.message);
      }
    }
    return localPlaybookError("service_unavailable");
  }
}

/** Shared lock ordering with connection reconfiguration, plus original actor revocation check. */
async function lockRun(tx: Tx, runId: number, siteId: number, actorId: number): Promise<RunRow> {
  const { rows: bindings } = await tx.execute(sql`SELECT c.id FROM watchguard_connections c
    JOIN epdr_local_playbook_runs r ON r.connection_id = c.id AND r.site_id = c.site_id AND r.account_revision = c.account_revision
    WHERE r.id = ${runId} AND r.site_id = ${siteId} AND c.enabled = true AND c.account_id <> '' FOR UPDATE OF c`);
  if (!bindings[0]) throw new Error("account_revision_changed");
  const { rows } = await tx.execute<RunRow>(sql`SELECT * FROM epdr_local_playbook_runs WHERE id = ${runId} AND site_id = ${siteId} FOR UPDATE`);
  const run = rows[0];
  if (!run || run.requested_by === null) throw new Error("requester_unavailable");
  await assertReadSyncActor(tx, siteId, actorId);
  if (run.requested_by !== actorId) await assertReadSyncActor(tx, siteId, run.requested_by);
  return run;
}

/** Explicit resumable execution of LOCAL outcomes only. No background dispatcher observes this table. */
export async function resumeEpdrLocalPlaybook(runId: number): Promise<{ runId: number; result: "finished" | "busy_or_finished" | "fenced" } | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!idSchema.safeParse(runId).success) return unavailable;
  const siteId = guard.activeSiteId;
  const actorId = guard.session.userId;
  try {
    const result = await runLocalPlaybook({
      claim: () => db.transaction(async (tx) => {
        await lockRun(tx, runId, siteId, actorId);
        const { rows } = await tx.execute<{ generation: number }>(sql`UPDATE epdr_local_playbook_runs
          SET status = 'running', generation = generation + 1, lease_until = clock_timestamp() + interval '60 seconds'
          WHERE id = ${runId} AND site_id = ${siteId} AND (status = 'pending' OR (status = 'running' AND lease_until <= clock_timestamp())) RETURNING generation`);
        if (!rows[0]) return null;
        const { rows: steps } = await tx.execute<LocalStep>(sql`SELECT ordinal, kind, action, status FROM epdr_local_playbook_steps
          WHERE run_id = ${runId} AND site_id = ${siteId} ORDER BY ordinal`);
        return { generation: rows[0].generation, steps };
      }),
      publish: (generation, ordinal, outcome) => db.transaction(async (tx) => {
        await lockRun(tx, runId, siteId, actorId);
        const { rows } = await tx.execute(sql`UPDATE epdr_local_playbook_steps s SET status = ${outcome.status}, reason = ${outcome.reason}, finished_at = clock_timestamp()
          WHERE s.run_id = ${runId} AND s.site_id = ${siteId} AND s.ordinal = ${ordinal} AND s.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM epdr_local_playbook_steps prior WHERE prior.run_id = s.run_id AND prior.ordinal < s.ordinal AND prior.status = 'pending')
          AND EXISTS (SELECT 1 FROM epdr_local_playbook_runs r WHERE r.id = s.run_id AND r.site_id = s.site_id
            AND r.status = 'running' AND r.generation = ${generation} AND r.lease_until > clock_timestamp()) RETURNING s.id`);
        return Boolean(rows[0]);
      }),
      finish: (generation) => db.transaction(async (tx) => {
        await lockRun(tx, runId, siteId, actorId);
        const { rows } = await tx.execute(sql`UPDATE epdr_local_playbook_runs r SET status = 'finished', finished_at = clock_timestamp(), lease_until = NULL
          WHERE r.id = ${runId} AND r.site_id = ${siteId} AND r.generation = ${generation} AND r.status = 'running' AND r.lease_until > clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM epdr_local_playbook_steps s WHERE s.run_id = r.id AND s.status = 'pending') RETURNING r.id`);
        return Boolean(rows[0]);
      }),
    });
    return { runId, result };
  } catch { return unavailable; }
}

export type LocalPlaybookRunSummary = {
  id: number; versionId: number; detectionId: number; status: RunRow["status"];
  createdAt: string; finishedAt: string | null;
};

export type LocalPlaybookRunPage = {
  rows: LocalPlaybookRunSummary[]; total: number; limit: number; page: number; pages: number;
};

/**
 * Bounded, pageable discovery for the playbook UI. An explicit start alone
 * returns the run id; this list lets an operator recover older runs after
 * reload. Pages are clamped to the last page so an offset past the end still
 * returns the newest valid slice.
 */
export async function getEpdrLocalPlaybookRuns(input: unknown = {}): Promise<LocalPlaybookRunPage | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = runsInputSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid local run page." };
  const requestedPage = parsed.data.page ?? 1;
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: counts } = await tx.execute<{ total: number }>(sql`
        SELECT count(*)::integer AS total FROM epdr_local_playbook_runs WHERE site_id = ${guard.activeSiteId}`);
      const total = Number(counts[0]?.total ?? 0);
      const pages = Math.max(1, Math.ceil(total / LOCAL_RUN_PAGE_SIZE));
      const page = Math.min(requestedPage, pages);
      const { rows } = await tx.execute<{ id: number; version_id: number; detection_id: number; status: RunRow["status"]; created_at: Date; finished_at: Date | null }>(sql`
        SELECT id, version_id, detection_id, status, created_at, finished_at FROM epdr_local_playbook_runs
        WHERE site_id = ${guard.activeSiteId} ORDER BY id DESC LIMIT ${LOCAL_RUN_PAGE_SIZE}
        OFFSET ${(page - 1) * LOCAL_RUN_PAGE_SIZE}`);
      return { limit: LOCAL_RUN_PAGE_SIZE, total, page, pages,
        rows: rows.map((row) => ({ id: row.id, versionId: row.version_id, detectionId: row.detection_id,
          status: row.status, createdAt: new Date(row.created_at).toISOString(),
          finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null })) };
    });
  } catch { return unavailable; }
}

/** Site-scoped detail includes immutable evidence and durable, ordered individual outcomes. */
export async function getEpdrLocalPlaybookRun(runId: number): Promise<LocalPlaybookRunDetail | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!idSchema.safeParse(runId).success) return unavailable;
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows } = await tx.execute<RunRow>(sql`SELECT * FROM epdr_local_playbook_runs WHERE id = ${runId} AND site_id = ${guard.activeSiteId}`);
      const run = rows[0];
      if (!run) throw new Error("run_unavailable");
      const { rows: steps } = await tx.execute<LocalStep & { reason: string | null; finished_at: Date | null }>(sql`SELECT ordinal, kind, action, status, reason, finished_at
        FROM epdr_local_playbook_steps WHERE run_id = ${runId} AND site_id = ${guard.activeSiteId} ORDER BY ordinal`);
      return { id: run.id, versionId: run.version_id, detectionId: run.detection_id, mode: "local", status: run.status,
        accountRevision: run.account_revision, evidence: run.evidence, createdAt: new Date(run.created_at).toISOString(),
        finishedAt: run.finished_at ? new Date(run.finished_at).toISOString() : null,
        steps: steps.map(({ finished_at, ...step }) => ({ ...step, finishedAt: finished_at ? new Date(finished_at).toISOString() : null })) };
    });
  } catch { return unavailable; }
}
