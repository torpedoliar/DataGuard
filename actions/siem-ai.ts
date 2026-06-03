"use server";

import { db } from "@/db";
import { siemFindings, siemSettings, syslogEvents, syslogEventsRaw } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis, type SiemAiEventSample } from "@/lib/siem/ai-analysis";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function testSiemAiConnection(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { ok: false, message: auth.message };

  const [settings] = await db.select().from(siemSettings).limit(1);

  // Prefer values typed into the form so admins can test before saving.
  // Fall back to the saved API key when the password field is left blank.
  const endpointUrl = normalizeOpenAiCompatibleEndpoint(
    process.env.SIEM_AI_ENDPOINT_URL || String(formData.get("aiEndpointUrl") ?? "").trim() || settings?.aiEndpointUrl || "",
  );
  const model = (process.env.SIEM_AI_DEFAULT_MODEL || String(formData.get("aiDefaultModel") ?? "").trim() || settings?.aiDefaultModel || "").trim();
  const formApiKey = String(formData.get("aiApiKey") ?? "").trim();
  const apiKey = process.env.SIEM_AI_API_KEY || formApiKey || settings?.aiApiKey || "";

  if (!endpointUrl) return { ok: false, message: "Endpoint URL belum diisi." };
  if (!model) return { ok: false, message: "Model belum diisi." };

  // Minimal prompt; the word "json" is required by some providers (e.g. DeepSeek)
  // when response_format=json_object is used.
  const prompt = 'Reply with the strict json object {"status":"ok"} and nothing else.';

  try {
    const startedAt = Date.now();
    const providerJson = await requestSiemAiAnalysis({ endpointUrl, apiKey, model, prompt });
    const elapsedMs = Date.now() - startedAt;
    void providerJson;
    return { ok: true, message: `Berhasil terhubung ke ${model} (${elapsedMs} ms).` };
  } catch (error) {
    console.error("SIEM AI connection test failed", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message: `Gagal terhubung: ${detail}` };
  }
}

export async function generateSiemAiAnalysis(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const findingId = Number(formData.get("id"));
  if (!findingId) return { message: "Invalid SIEM finding." };

  const [settings] = await db.select().from(siemSettings).limit(1);
  if (!settings?.aiEnabled) return { message: "SIEM AI analysis is disabled." };

  const endpointUrl = normalizeOpenAiCompatibleEndpoint(process.env.SIEM_AI_ENDPOINT_URL || settings.aiEndpointUrl || "");
  const apiKey = process.env.SIEM_AI_API_KEY || settings.aiApiKey || "";
  const model = (process.env.SIEM_AI_DEFAULT_MODEL || settings.aiDefaultModel || "").trim();
  if (!endpointUrl || !model) return { message: "SIEM AI endpoint dan model harus dikonfigurasi." };

  const finding = await db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)),
    with: { rule: true, source: true, device: true },
  });
  if (!finding) return { message: "SIEM finding not found." };

  const sampleEventIds = finding.sampleEventIds.slice(0, settings.aiMaxSampleEvents);
  const eventRows = sampleEventIds.length > 0
    ? await db.select({
      id: syslogEvents.id,
      receivedAt: syslogEvents.receivedAt,
      category: syslogEvents.category,
      normalizedType: syslogEvents.normalizedType,
      action: syslogEvents.action,
      outcome: syslogEvents.outcome,
      username: syslogEvents.username,
      srcIp: syslogEvents.srcIp,
      dstIp: syslogEvents.dstIp,
      message: syslogEvents.message,
      rawMessage: syslogEventsRaw.rawMessage,
    }).from(syslogEvents)
      .leftJoin(syslogEventsRaw, eq(syslogEvents.rawEventId, syslogEventsRaw.id))
      .where(and(eq(syslogEvents.siteId, auth.activeSiteId), inArray(syslogEvents.id, sampleEventIds)))
    : [];

  const prompt = buildSiemAiPrompt({
    maxRawLength: settings.aiMaxRawLength,
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
    await logAudit({ action: "UPDATE", entity: "siem_finding", entityId: finding.id, entityName: finding.title, detail: "SIEM AI analysis generated" });
    revalidatePath("/admin/siem/findings");
    return { success: true };
  } catch (error) {
    console.error("SIEM AI analysis failed", error);
    return { message: "SIEM AI provider failed to generate analysis." };
  }
}
