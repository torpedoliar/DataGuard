"use server";

import { db } from "@/db";
import { siemRules, siemSettings } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { encryptString } from "@/lib/crypto";
import { DEFAULT_SIEM_RULES } from "@/lib/siem/default-rules";
import { parseSiemRulesFormData } from "@/lib/siem/rule-settings-form";
import { runSiemRetentionCleanup } from "@/lib/siem/retention";
import { siemSeverities } from "@/lib/siem/types";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const aiSettingsSchema = z.object({
  aiEnabled: z.coerce.boolean(),
  aiEndpointUrl: z.string().url("Endpoint AI harus berupa URL valid.").max(500),
  aiApiKey: z.string().max(500).optional(),
  aiDefaultModel: z.string().min(1, "Model wajib diisi.").max(120),
  aiMaxSampleEvents: z.coerce.number().int().min(1).max(20),
  aiMaxRawLength: z.coerce.number().int().min(200).max(10000),
  // Per-finding regeneration cooldown. 0 disables the gate entirely so an
  // operator can still always re-run on demand. Default in the DB is 1h.
  aiRegenerateCooldownSec: z.coerce.number().int().min(0).max(86400),
});

const ingestSettingsSchema = z.object({
  alertMinSeverity: z.enum(siemSeverities),
  rawRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  eventRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  findingRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  alertRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  tcpPort: z
    .union([z.coerce.number().int().min(1).max(65535), z.literal("")])
    .transform((value) => (value === "" ? null : value))
    .optional(),
  tlsPort: z
    .union([z.coerce.number().int().min(1).max(65535), z.literal("")])
    .transform((value) => (value === "" ? null : value))
    .optional(),
  tlsCertPath: z.string().max(500).optional().or(z.literal("")),
  tlsKeyPath: z.string().max(500).optional().or(z.literal("")),
});

export async function getSiemAiSettings() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const [settings] = await db.select().from(siemSettings).where(eq(siemSettings.siteId, auth.activeSiteId)).limit(1);
  return {
    aiEnabled: settings?.aiEnabled ?? false,
    aiEndpointUrl: settings?.aiEndpointUrl ?? "",
    aiApiKeyConfigured: Boolean(settings?.aiApiKey?.trim() || process.env.SIEM_AI_API_KEY?.trim()),
    aiDefaultModel: settings?.aiDefaultModel ?? "",
    aiReady: Boolean((process.env.SIEM_AI_ENDPOINT_URL || settings?.aiEndpointUrl) && (process.env.SIEM_AI_DEFAULT_MODEL || settings?.aiDefaultModel)),
    aiMaxSampleEvents: settings?.aiMaxSampleEvents ?? 5,
    aiMaxRawLength: settings?.aiMaxRawLength ?? 2000,
    aiRegenerateCooldownSec: settings?.aiRegenerateCooldownSec ?? 3600,
  };
}

export async function updateSiemAiSettings(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = aiSettingsSchema.safeParse({
    aiEnabled: formData.get("aiEnabled") === "true",
    aiEndpointUrl: formData.get("aiEndpointUrl"),
    aiApiKey: String(formData.get("aiApiKey") ?? ""),
    aiDefaultModel: formData.get("aiDefaultModel"),
    aiMaxSampleEvents: formData.get("aiMaxSampleEvents"),
    aiMaxRawLength: formData.get("aiMaxRawLength"),
    aiRegenerateCooldownSec: formData.get("aiRegenerateCooldownSec"),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const [existing] = await db.select({ id: siemSettings.id, aiApiKey: siemSettings.aiApiKey }).from(siemSettings).where(eq(siemSettings.siteId, auth.activeSiteId)).limit(1);
  const values: Partial<typeof siemSettings.$inferInsert> = {
    aiEnabled: parsed.data.aiEnabled,
    aiEndpointUrl: parsed.data.aiEndpointUrl.trim(),
    aiDefaultModel: parsed.data.aiDefaultModel.trim(),
    aiMaxSampleEvents: parsed.data.aiMaxSampleEvents,
    aiMaxRawLength: parsed.data.aiMaxRawLength,
    aiRegenerateCooldownSec: parsed.data.aiRegenerateCooldownSec,
    updatedAt: new Date(),
  };
  if (parsed.data.aiApiKey?.trim()) values.aiApiKey = encryptString(parsed.data.aiApiKey.trim());

  if (existing) await db.update(siemSettings).set(values).where(eq(siemSettings.id, existing.id));
  else await db.insert(siemSettings).values({ ...values, siteId: auth.activeSiteId, aiApiKey: values.aiApiKey ?? null });

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM AI", detail: "SIEM AI settings updated" });
  revalidatePath("/admin/settings");
  return { success: true };
}

export async function getSiemIngestSettings() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const [settings] = await db.select().from(siemSettings).where(eq(siemSettings.siteId, auth.activeSiteId)).limit(1);

  return {
    alertMinSeverity: (settings?.alertMinSeverity ?? "High") as (typeof siemSeverities)[number],
    rawRetentionDays: settings?.rawRetentionDays ?? 90,
    eventRetentionDays: settings?.eventRetentionDays ?? 180,
    findingRetentionDays: settings?.findingRetentionDays ?? 365,
    alertRetentionDays: settings?.alertRetentionDays ?? 365,
    tcpPort: settings?.tcpPort ?? null,
    tlsPort: settings?.tlsPort ?? null,
    tlsCertPath: settings?.tlsCertPath ?? "",
    tlsKeyPath: settings?.tlsKeyPath ?? "",
  };
}

export async function updateSiemIngestSettings(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = ingestSettingsSchema.safeParse({
    alertMinSeverity: formData.get("alertMinSeverity"),
    rawRetentionDays: formData.get("rawRetentionDays") || undefined,
    eventRetentionDays: formData.get("eventRetentionDays") || undefined,
    findingRetentionDays: formData.get("findingRetentionDays") || undefined,
    alertRetentionDays: formData.get("alertRetentionDays") || undefined,
    tcpPort: formData.get("tcpPort") ?? "",
    tlsPort: formData.get("tlsPort") ?? "",
    tlsCertPath: formData.get("tlsCertPath") ?? "",
    tlsKeyPath: formData.get("tlsKeyPath") ?? "",
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const [existing] = await db.select({ id: siemSettings.id }).from(siemSettings).where(eq(siemSettings.siteId, auth.activeSiteId)).limit(1);
  const values: Partial<typeof siemSettings.$inferInsert> = {
    alertMinSeverity: parsed.data.alertMinSeverity,
    rawRetentionDays: parsed.data.rawRetentionDays ?? undefined,
    eventRetentionDays: parsed.data.eventRetentionDays ?? undefined,
    findingRetentionDays: parsed.data.findingRetentionDays ?? undefined,
    alertRetentionDays: parsed.data.alertRetentionDays ?? undefined,
    tcpPort: parsed.data.tcpPort ?? null,
    tlsPort: parsed.data.tlsPort ?? null,
    tlsCertPath: (parsed.data.tlsCertPath ?? "").trim() || null,
    tlsKeyPath: (parsed.data.tlsKeyPath ?? "").trim() || null,
    updatedAt: new Date(),
  };

  if (existing) await db.update(siemSettings).set(values).where(eq(siemSettings.id, existing.id));
  else await db.insert(siemSettings).values({ ...values, siteId: auth.activeSiteId });

  // Fire retention cleanup in background so new retention policy takes effect immediately
  void runSiemRetentionCleanup({ batchSize: 2000 }).catch((err) => {
    console.error("Auto SIEM retention cleanup failed after settings update:", err);
  });

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM Ingest", detail: "SIEM ingest settings updated" });
  revalidatePath("/admin/settings");
  return { success: true };
}

export async function runSiemRetentionNow() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { success: false, message: auth.message };

  try {
    const result = await runSiemRetentionCleanup({ batchSize: 2000 });
    await logAudit({
      action: "DELETE",
      entity: "settings",
      entityName: "SIEM Retention",
      detail: `Manual cleanup executed: ${result.rawEventsDeleted} raw, ${result.eventsDeleted} events, ${result.findingsDeleted} findings, ${result.alertsDeleted} alerts deleted; ${result.partitionsDropped} partitions dropped`,
    });

    return {
      success: true,
      result,
      message: `Pembersihan berhasil: ${result.rawEventsDeleted} raw events, ${result.eventsDeleted} events, ${result.findingsDeleted} findings, ${result.alertsDeleted} alerts dibersihkan. (${result.partitionsDropped} partisi kedaluwarsa didrop)`,
    };
  } catch (error) {
    console.error("Manual SIEM retention run failed:", error);
    return {
      success: false,
      message: `Gagal menjalankan retensi: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const SEVERITY_RANK: Record<(typeof siemSeverities)[number], number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

export async function getSiemRules() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  let rules = await db
    .select({
      id: siemRules.id,
      key: siemRules.key,
      name: siemRules.name,
      description: siemRules.description,
      category: siemRules.category,
      severity: siemRules.severity,
      enabled: siemRules.enabled,
      alertEnabled: siemRules.alertEnabled,
    })
    .from(siemRules)
    .where(eq(siemRules.siteId, auth.activeSiteId));

  // ponytail: lazy seed default rules for a site that has none yet. Guaranteed
  // empty set (scoped by siteId), so plain insert — no onConflict needed here.
  if (rules.length === 0) {
    await db.insert(siemRules).values(
      DEFAULT_SIEM_RULES.map((rule) => ({
        siteId: auth.activeSiteId,
        key: rule.key,
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        severity: rule.severity,
        category: rule.category,
        ruleType: rule.ruleType,
        conditions: rule.conditions,
        groupBy: rule.groupBy,
        threshold: rule.threshold,
        windowSeconds: rule.windowSeconds,
        cooldownSeconds: rule.cooldownSeconds,
        alertEnabled: rule.alertEnabled,
      })),
    );
    rules = await db
      .select({
        id: siemRules.id,
        key: siemRules.key,
        name: siemRules.name,
        description: siemRules.description,
        category: siemRules.category,
        severity: siemRules.severity,
        enabled: siemRules.enabled,
        alertEnabled: siemRules.alertEnabled,
      })
      .from(siemRules)
      .where(eq(siemRules.siteId, auth.activeSiteId));
  }

  rules.sort((a, b) =>
    a.category === b.category
      ? SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );

  const [settings] = await db.select({ alertMinSeverity: siemSettings.alertMinSeverity }).from(siemSettings).where(eq(siemSettings.siteId, auth.activeSiteId)).limit(1);

  return {
    rules,
    alertMinSeverity: (settings?.alertMinSeverity ?? "High") as (typeof siemSeverities)[number],
  };
}

export async function updateSiemRules(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  let parsed;
  try {
    parsed = parseSiemRulesFormData(formData);
  } catch {
    return { errors: { alertMinSeverity: ["Data form rule tidak valid."] } };
  }

  await db.transaction(async (tx) => {
    for (const rule of parsed.rules) {
      await tx
        .update(siemRules)
        .set({ enabled: rule.enabled, alertEnabled: rule.alertEnabled, updatedAt: new Date() })
        .where(and(eq(siemRules.id, rule.id), eq(siemRules.siteId, auth.activeSiteId)));
    }

    const [existing] = await tx.select({ id: siemSettings.id }).from(siemSettings).where(eq(siemSettings.siteId, auth.activeSiteId)).limit(1);
    if (existing) {
      await tx.update(siemSettings).set({ alertMinSeverity: parsed.alertMinSeverity, updatedAt: new Date() }).where(eq(siemSettings.id, existing.id));
    } else {
      await tx.insert(siemSettings).values({ siteId: auth.activeSiteId, alertMinSeverity: parsed.alertMinSeverity });
    }
  });

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM Rules", detail: `Updated ${parsed.rules.length} rule(s), min severity ${parsed.alertMinSeverity}` });
  revalidatePath("/admin/siem/rules");
  return { success: true };
}

const ruleDetailSchema = z.object({
  id: z.coerce.number().int().min(1),
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).default(""),
  severity: z.enum(siemSeverities),
  category: z.string().min(1, "Category is required").max(100),
  threshold: z
    .union([z.coerce.number().int().min(1).max(100000), z.literal("")])
    .transform((value) => (value === "" ? null : value))
    .optional(),
  windowSeconds: z
    .union([z.coerce.number().int().min(1).max(86400), z.literal("")])
    .transform((value) => (value === "" ? null : value))
    .optional(),
  conditions: z.string().refine(
    (value) => {
      if (!value.trim()) return true;
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Conditions must be valid JSON." },
  ).optional(),
});

export async function updateSiemRuleDetail(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const conditionsRaw = String(formData.get("conditions") ?? "");
  const parsed = ruleDetailSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    severity: formData.get("severity"),
    category: formData.get("category"),
    threshold: formData.get("threshold") ?? "",
    windowSeconds: formData.get("windowSeconds") ?? "",
    conditions: conditionsRaw,
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const existing = await db.query.siemRules.findFirst({ where: and(eq(siemRules.id, parsed.data.id), eq(siemRules.siteId, auth.activeSiteId)) });
  if (!existing) return { message: "SIEM rule not found." };

  // Parse the conditions JSON (or empty object when blank) so we can persist a
  // proper jsonb object. Validation above ensures it's parseable; we just
  // convert the empty-string sentinel to {} for storage. The schema column
  // is NOT NULL so we must always send a value.
  let conditionsValue: Record<string, unknown> = {};
  const trimmedConditions = parsed.data.conditions?.trim() ?? "";
  if (trimmedConditions) {
    try {
      const parsedConditions = JSON.parse(trimmedConditions);
      conditionsValue = (parsedConditions && typeof parsedConditions === "object" && !Array.isArray(parsedConditions))
        ? (parsedConditions as Record<string, unknown>)
        : {};
    } catch {
      return { errors: { conditions: ["Conditions must be valid JSON."] } };
    }
  }

  await db
    .update(siemRules)
    .set({
      name: parsed.data.name,
      description: parsed.data.description,
      severity: parsed.data.severity,
      category: parsed.data.category,
      threshold: parsed.data.threshold ?? null,
      windowSeconds: parsed.data.windowSeconds ?? null,
      conditions: conditionsValue,
      updatedAt: new Date(),
    })
    .where(and(eq(siemRules.id, parsed.data.id), eq(siemRules.siteId, auth.activeSiteId)));

  revalidatePath("/admin/siem/rules");
  await logAudit({
    action: "UPDATE",
    entity: "settings",
    entityName: "SIEM Rule",
    entityId: parsed.data.id,
    detail: `Updated rule "${parsed.data.name}" (${parsed.data.severity}, ${parsed.data.category})`,
  });
  return { success: true, message: "SIEM rule updated." };
}
