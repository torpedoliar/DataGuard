"use server";

import { db } from "@/db";
import { siemFindings, siemSettings, syslogEvents, syslogEventsRaw } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { buildSiemAiPrompt, normalizeOpenAiCompatibleEndpoint, normalizeSiemAiAnalysis, requestSiemAiAnalysis, type SiemAiEventSample } from "@/lib/siem/ai-analysis";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
