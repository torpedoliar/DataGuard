"use server";

import { db } from "@/db";
import { siemSettings } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { decryptIfEncrypted } from "@/lib/crypto";
import { detectAiAuthRequirement, normalizeOpenAiCompatibleEndpoint } from "@/lib/siem/ai-analysis";
import { generateSiemAiAnalysisForFinding } from "@/lib/siem/ai-queue";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { siemFindings } from "@/db/schema";

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
  // N49: stored aiApiKey may be encrypted; decrypt for use as a plaintext
  // bearer token. decryptIfEncrypted returns the input unchanged for legacy
  // plaintext rows so the test connection still works during the rollout.
  const storedApiKey = decryptIfEncrypted(settings?.aiApiKey ?? null) ?? "";
  const apiKey = process.env.SIEM_AI_API_KEY || formApiKey || storedApiKey;

  if (!endpointUrl) return { ok: false, message: "Endpoint URL belum diisi." };
  if (!model) return { ok: false, message: "Model belum diisi." };

  // Minimal prompt; the word "json" is required by some providers (e.g. DeepSeek)
  // when response_format=json_object is used.
  const prompt = 'Reply with the strict json object {"status":"ok"} and nothing else.';

  try {
    const startedAt = Date.now();
    // Lazy-load to keep the test action on a different code path from generation.
    const { requestSiemAiAnalysis } = await import("@/lib/siem/ai-analysis");
    const providerJson = await requestSiemAiAnalysis({ endpointUrl, apiKey, model, prompt });
    const elapsedMs = Date.now() - startedAt;
    void providerJson;
    return { ok: true, message: `Berhasil terhubung ke ${model} (${elapsedMs} ms).` };
  } catch (error) {
    // If the provider rejected with 401/403, run a lightweight auth probe so the
    // operator can see *why* the call failed ("the gateway requires a key" is
    // far more actionable than a raw HTTP 401 stack). The probe is best-effort.
    const probe = await detectAiAuthRequirement(endpointUrl).catch(() => null);
    const detail = error instanceof Error ? error.message : "Unknown error";
    const requiresKey = probe?.requiresKey ?? /HTTP 401|HTTP 403/.test(detail);
    if (requiresKey) {
      return {
        ok: false,
        message: `Gagal terhubung: ${detail} — endpoint ini sepertinya membutuhkan API key. Isi kolom API Key lalu coba lagi.`,
        requiresKey: true,
      };
    }
    return { ok: false, message: `Gagal terhubung: ${detail}` };
  }
}

export async function generateSiemAiAnalysis(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const findingId = Number(formData.get("id"));
  if (!findingId) return { message: "Invalid SIEM finding." };

  // Confirm the finding belongs to the active site before doing any work.
  const finding = await db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)),
  });
  if (!finding) return { message: "SIEM finding not found." };

  const [settings] = await db.select().from(siemSettings).limit(1);
  if (!settings?.aiEnabled) return { message: "SIEM AI analysis is disabled." };

  // N18: per-finding regeneration cooldown (default 1h, configurable via
  // `siemSettings.aiRegenerateCooldownSec`). Operators can still regenerate on
  // demand after the window elapses, but a hot finding is short-circuited so
  // we do not pay for an LLM call on every accidental click.
  const cooldownSec = settings.aiRegenerateCooldownSec ?? 3600;
  if (finding.aiGeneratedAt) {
    const ageSec = (Date.now() - finding.aiGeneratedAt.getTime()) / 1000;
    if (ageSec < cooldownSec) {
      const remaining = Math.max(0, Math.round(cooldownSec - ageSec));
      return {
        message: `AI analysis regenerated ${Math.floor(ageSec)}s ago. Cooldown is ${cooldownSec}s (try again in ${remaining}s).`,
        cooldownRemainingSec: remaining,
        cooldownSec,
        lastRegeneratedAt: finding.aiGeneratedAt.toISOString(),
      };
    }
  }

  const result = await generateSiemAiAnalysisForFinding(findingId, {
    maxSampleEvents: settings.aiMaxSampleEvents,
    maxRawLength: settings.aiMaxRawLength,
  });
  if (!result.ok) {
    return { message: result.error === "AI provider failed" ? "SIEM AI provider failed to generate analysis." : (result.error ?? "SIEM AI failed.") };
  }
  revalidatePath("/admin/siem/findings");
  void logAudit; // logAudit is invoked inside the lib helper.
  return { success: true };
}
