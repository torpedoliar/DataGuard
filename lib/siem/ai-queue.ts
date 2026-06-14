import { db } from "../../db";
import { siemAiJobs, siemFindings, siemSettings } from "../../db/schema";
import { logAudit } from "../audit";
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis, type SiemAiEventSample } from "./ai-analysis";
import { getFindingEvidence } from "./evidence";
import { eq, sql } from "drizzle-orm";

const AI_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const HIGH_SEVERITIES = new Set(["High", "Critical"]);

export type QueueSiemAiFindingInput = {
  id: number;
  aiGeneratedAt: Date | null;
  severity: string;
  status: string;
};

/**
 * If AI is enabled and the finding is High/Critical with no recent analysis
 * (within the 1h cooldown), insert a row into `siem_ai_jobs`. Returns true
 * when a job was enqueued, false otherwise.
 */
export async function queueSiemAiAnalysis(finding: QueueSiemAiFindingInput): Promise<boolean> {
  if (!HIGH_SEVERITIES.has(finding.severity)) return false;
  if (finding.aiGeneratedAt && finding.aiGeneratedAt.getTime() > Date.now() - AI_COOLDOWN_MS) {
    return false;
  }

  const [settings] = await db.select().from(siemSettings).limit(1);
  if (!settings?.aiEnabled) return false;

  await db.insert(siemAiJobs).values({
    findingId: finding.id,
    status: "pending",
    attempts: 0,
  });
  return true;
}

export type SiemAiGenerationResult = {
  ok: boolean;
  error?: string;
};

/**
 * Pure generator: fetch settings, evidence, prompt the provider, and write the
 * analysis back to the finding. No auth check — the caller (server action or
 * worker) is responsible for verifying the AI feature is enabled. Returns
 * `{ok:false, error}` on any failure so the caller can mark the job failed.
 *
 * This is factored out of `actions/siem-ai.ts` so the worker can reuse it
 * across the `"use server"` boundary.
 */
export async function generateSiemAiAnalysisForFinding(
  findingId: number,
  options: { maxSampleEvents: number; maxRawLength: number },
): Promise<SiemAiGenerationResult> {
  const [settings] = await db.select().from(siemSettings).limit(1);
  if (!settings?.aiEnabled) return { ok: false, error: "AI disabled" };

  const endpointUrl = normalizeOpenAiCompatibleEndpoint(process.env.SIEM_AI_ENDPOINT_URL || settings.aiEndpointUrl || "");
  const apiKey = process.env.SIEM_AI_API_KEY || settings.aiApiKey || "";
  const model = (process.env.SIEM_AI_DEFAULT_MODEL || settings.aiDefaultModel || "").trim();
  if (!endpointUrl || !model) return { ok: false, error: "Endpoint/model not configured" };

  const finding = await db.query.siemFindings.findFirst({
    where: eq(siemFindings.id, findingId),
    with: { rule: true, source: true, device: true },
  });
  if (!finding) return { ok: false, error: "Finding not found" };

  const eventRows = await getFindingEvidence(
    { id: finding.id, evidenceArchived: finding.evidenceArchived, sampleEventIds: finding.sampleEventIds },
    { limit: options.maxSampleEvents, siteId: finding.siteId ?? 0 },
  );

  const prompt = buildSiemAiPrompt({
    maxRawLength: options.maxRawLength,
    finding: {
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      summary: finding.summary,
      humanAnalysis: finding.humanAnalysis,
      recommendedAction: finding.recommendedAction,
      eventCount: finding.eventCount,
      correlationKey: finding.correlationKey,
      sourceIp: finding.source?.sourceIp ?? null,
      deviceName: finding.device?.name ?? null,
      ruleName: finding.rule?.name ?? null,
      ruleDescription: finding.rule?.description ?? null,
    },
    events: eventRows as SiemAiEventSample[],
  });

  try {
    const providerJson = await requestSiemAiAnalysis({ endpointUrl, apiKey, model, prompt });
    const analysis = normalizeSiemAiAnalysis(providerJson, model);
    await db.update(siemFindings).set({ aiAnalysis: analysis, aiGeneratedAt: new Date(), updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
    await logAudit({
      action: "UPDATE",
      entity: "siem_finding",
      entityId: finding.id,
      entityName: finding.title,
      detail: "SIEM AI analysis generated",
    });
    return { ok: true };
  } catch (error) {
    console.error("SIEM AI analysis failed", error);
    return { ok: false, error: "AI provider failed" };
  }
}

export type SiemAiWorkerResult = { processed: number; completed: number; failed: number };

/**
 * Process pending AI jobs: claim one with `FOR UPDATE SKIP LOCKED`, call
 * `generateSiemAiAnalysisForFinding`, update job status. Skips findings whose
 * `aiGeneratedAt` is still within the 1h cooldown.
 */
export async function runSiemAiWorkerOnce(): Promise<SiemAiWorkerResult> {
  const result: SiemAiWorkerResult = { processed: 0, completed: 0, failed: 0 };

  // Claim up to one pending job using SKIP LOCKED for multi-worker safety.
  const claimed = await db.execute<{ id: number; finding_id: number; attempts: number }>(sql`
    SELECT id, finding_id, attempts
    FROM ${siemAiJobs}
    WHERE status = 'pending'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `);
  const job = claimed.rows[0];
  if (!job) return result;

  result.processed += 1;

  // Honour the cooldown: skip if the finding already has fresh analysis.
  const [finding] = await db.select({
    id: siemFindings.id,
    aiGeneratedAt: siemFindings.aiGeneratedAt,
    severity: siemFindings.severity,
    title: siemFindings.title,
  }).from(siemFindings).where(eq(siemFindings.id, job.finding_id));
  if (!finding) {
    await db.update(siemAiJobs).set({ status: "failed", lastError: "Finding not found", completedAt: new Date() }).where(eq(siemAiJobs.id, job.id));
    result.failed += 1;
    return result;
  }
  if (finding.aiGeneratedAt && finding.aiGeneratedAt.getTime() > Date.now() - AI_COOLDOWN_MS) {
    await db.update(siemAiJobs).set({ status: "completed", completedAt: new Date() }).where(eq(siemAiJobs.id, job.id));
    return result;
  }

  // Mark running and pull the live settings to drive sample/raw sizes.
  await db.update(siemAiJobs).set({ status: "running", startedAt: new Date(), attempts: job.attempts + 1 }).where(eq(siemAiJobs.id, job.id));

  const [settings] = await db.select().from(siemSettings).limit(1);
  if (!settings) {
    await db.update(siemAiJobs).set({ status: "failed", lastError: "Settings missing", completedAt: new Date() }).where(eq(siemAiJobs.id, job.id));
    result.failed += 1;
    return result;
  }

  const gen = await generateSiemAiAnalysisForFinding(finding.id, {
    maxSampleEvents: settings.aiMaxSampleEvents,
    maxRawLength: settings.aiMaxRawLength,
  });

  if (gen.ok) {
    await db.update(siemAiJobs).set({ status: "completed", completedAt: new Date(), lastError: null }).where(eq(siemAiJobs.id, job.id));
    await logAudit({ action: "UPDATE", entity: "siem_finding", entityId: finding.id, entityName: finding.title, detail: `AI job completed (severity ${finding.severity})` });
    result.completed += 1;
  } else {
    await db.update(siemAiJobs).set({ status: "failed", lastError: gen.error ?? "unknown", completedAt: new Date() }).where(eq(siemAiJobs.id, job.id));
    await logAudit({ action: "UPDATE", entity: "siem_finding", entityId: finding.id, entityName: finding.title, detail: `AI job failed: ${gen.error ?? "unknown"}` });
    result.failed += 1;
  }

  return result;
}
