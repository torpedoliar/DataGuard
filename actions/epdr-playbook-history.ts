"use server";

import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { assertReadSyncActor } from "@/lib/epdr/read-sync-queue";
import { playbookConfigSchema, playbookConfigMatches } from "@/lib/epdr/playbook-config";
import { PLAYBOOK_TEMPLATES } from "@/lib/epdr/playbooks";
import { previewEpdrPlaybooks } from "./epdr-playbooks";

export type SavedPlaybookVersion = { id: number; templateId: string; name: string; version: number; createdAt: string };
export type SavedPlaybookRun = { id: number; versionId: number; status: "simulation_recorded"; createdAt: string; evidence: unknown };
export type PlaybookHistoryPage = {
  versions: SavedPlaybookVersion[]; runs: SavedPlaybookRun[]; limit: number;
  versionsPage: number; versionsPages: number; versionsTotal: number;
  runsPage: number; runsPages: number; runsTotal: number;
};
const historyInputSchema = z.object({
  versionsPage: z.number().int().min(1).max(10_000).optional(),
  runsPage: z.number().int().min(1).max(10_000).optional(),
}).strict();
const HISTORY_PAGE_SIZE = 50;

/** No update API: each save appends a new simulation-only version. */
export async function saveEpdrPlaybookVersion(input: unknown): Promise<{ id: number; version: number } | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = playbookConfigSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid simulation configuration." };
  try {
    return await db.transaction(async (tx) => {
      // Serialize version allocation per site, including concurrent first saves.
      await tx.execute(sql`SELECT id FROM sites WHERE id = ${guard.activeSiteId} FOR UPDATE`);
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows } = await tx.execute<{ id: number; version: number }>(sql`
        INSERT INTO epdr_playbook_versions (site_id, template_id, version, name, mode, configuration, definition, created_by)
        SELECT ${guard.activeSiteId}, ${parsed.data.templateId}, coalesce(max(version), 0) + 1,
          ${parsed.data.name}, 'simulate', ${JSON.stringify(parsed.data)}::jsonb,
          ${JSON.stringify({ schemaVersion: 1, template: PLAYBOOK_TEMPLATES.find((item) => item.id === parsed.data.templateId) })}::jsonb, ${guard.session.userId}
        FROM epdr_playbook_versions WHERE site_id = ${guard.activeSiteId} AND template_id = ${parsed.data.templateId}
        RETURNING id, version`);
      if (!rows[0]) throw new Error("version_not_saved");
      return rows[0];
    });
  } catch { return { message: "Playbook could not be saved. Check access and required migrations." }; }
}

/** Explicit evidence recording only; never creates Incidents, notifications or work items. */
export async function recordEpdrPlaybookSimulation(versionId: number): Promise<{ id: number } | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  if (!Number.isSafeInteger(versionId) || versionId < 1) return { message: "Invalid version." };
  try {
    const { rows } = await db.execute<{ configuration: unknown; definition: unknown }>(sql`SELECT configuration, definition FROM epdr_playbook_versions
      WHERE id = ${versionId} AND site_id = ${guard.activeSiteId} AND mode = 'simulate'`);
    const config = playbookConfigSchema.safeParse(rows[0]?.configuration);
    if (!config.success) return { message: "Simulation version unavailable." };
    const template = PLAYBOOK_TEMPLATES.find((item) => item.id === config.data.templateId)!;
    // A changed catalog requires a new version; never reinterpret old definitions.
    if (!isDeepStrictEqual(rows[0].definition, { schemaVersion: 1, template })) {
      return { message: "Template definition changed. Save a new simulation version." };
    }
    const preview = await previewEpdrPlaybooks();
    if ("message" in preview || preview.siteId !== guard.activeSiteId) return { message: "Site evidence unavailable." };
    const evidence = {
      schemaVersion: 1, mode: "simulate", providerLocked: true, sampledAt: preview.sampledAt, since: preview.since,
      steps: PLAYBOOK_TEMPLATES.find((template) => template.id === config.data.templateId)!.steps.map((step, ordinal) => ({ step, ordinal, state: "inert" })),
      limit: preview.limit, truncated: preview.truncated, detectionCompleteness: preview.detectionCompleteness,
      rows: preview.rows.filter((row) => playbookConfigMatches(config.data, row)).map((row) => ({
        id: row.id, source: row.source, category: row.category, score: row.score,
        result: row.evaluations.find((item) => item.templateId === config.data.templateId)?.result,
      })),
    };
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: runs } = await tx.execute<{ id: number }>(sql`INSERT INTO epdr_playbook_runs
        (site_id, version_id, requested_by, status, evidence)
        SELECT site_id, id, ${guard.session.userId}, 'simulation_recorded', ${JSON.stringify(evidence)}::jsonb
        FROM epdr_playbook_versions WHERE id = ${versionId} AND site_id = ${guard.activeSiteId} AND mode = 'simulate'
        RETURNING id`);
      if (!runs[0]) throw new Error("version_unavailable");
      return runs[0];
    });
  } catch { return { message: "Simulation could not be recorded. No provider action was requested." }; }
}

/** Pageable, site-scoped history. Out-of-range pages clamp to the last page. */
export async function getEpdrPlaybookHistory(input: unknown = {}): Promise<PlaybookHistoryPage | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = historyInputSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid history page." };
  const requestedVersionsPage = parsed.data.versionsPage ?? 1;
  const requestedRunsPage = parsed.data.runsPage ?? 1;
  try {
    return await db.transaction(async (tx) => {
      await assertReadSyncActor(tx, guard.activeSiteId, guard.session.userId);
      const { rows: versionCounts } = await tx.execute<{ total: number }>(sql`
        SELECT count(*)::integer AS total FROM epdr_playbook_versions WHERE site_id = ${guard.activeSiteId}`);
      const { rows: runCounts } = await tx.execute<{ total: number }>(sql`
        SELECT count(*)::integer AS total FROM epdr_playbook_runs WHERE site_id = ${guard.activeSiteId}`);
      const versionsTotal = Number(versionCounts[0]?.total ?? 0);
      const runsTotal = Number(runCounts[0]?.total ?? 0);
      const versionsPages = Math.max(1, Math.ceil(versionsTotal / HISTORY_PAGE_SIZE));
      const runsPages = Math.max(1, Math.ceil(runsTotal / HISTORY_PAGE_SIZE));
      const versionsPage = Math.min(requestedVersionsPage, versionsPages);
      const runsPage = Math.min(requestedRunsPage, runsPages);
      const { rows: versions } = await tx.execute<{ id: number; template_id: string; name: string; version: number; created_at: Date }>(sql`
        SELECT id, template_id, name, version, created_at FROM epdr_playbook_versions
        WHERE site_id = ${guard.activeSiteId} ORDER BY id DESC LIMIT ${HISTORY_PAGE_SIZE}
        OFFSET ${(versionsPage - 1) * HISTORY_PAGE_SIZE}`);
      const { rows: runs } = await tx.execute<{ id: number; version_id: number; status: "simulation_recorded"; created_at: Date; evidence: unknown }>(sql`
        SELECT id, version_id, status, created_at, evidence FROM epdr_playbook_runs
        WHERE site_id = ${guard.activeSiteId} ORDER BY id DESC LIMIT ${HISTORY_PAGE_SIZE}
        OFFSET ${(runsPage - 1) * HISTORY_PAGE_SIZE}`);
      return { limit: HISTORY_PAGE_SIZE, versionsPage, versionsPages, versionsTotal, runsPage, runsPages, runsTotal,
        versions: versions.map((row) => ({ id: row.id, templateId: row.template_id, name: row.name, version: row.version, createdAt: new Date(row.created_at).toISOString() })),
        runs: runs.map((row) => ({ id: row.id, versionId: row.version_id, status: row.status, createdAt: new Date(row.created_at).toISOString(), evidence: row.evidence })),
      };
    });
  } catch { return { message: "History unavailable. Check access and required migrations." }; }
}
