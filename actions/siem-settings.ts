"use server";

import { db } from "@/db";
import { siemRules, siemSettings, sites } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { parseSiemRulesFormData } from "@/lib/siem/rule-settings-form";
import { siemSeverities } from "@/lib/siem/types";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const aiSettingsSchema = z.object({
  aiEnabled: z.coerce.boolean(),
  aiEndpointUrl: z.string().url("Endpoint AI harus berupa URL valid.").max(500),
  aiApiKey: z.string().max(500).optional(),
  aiDefaultModel: z.string().min(1, "Model wajib diisi.").max(120),
  aiMaxSampleEvents: z.coerce.number().int().min(1).max(20),
  aiMaxRawLength: z.coerce.number().int().min(200).max(10000),
});

const ingestSettingsSchema = z.object({
  defaultSiemSiteId: z
    .union([z.coerce.number().int().positive(), z.literal("")])
    .transform((value) => (value === "" ? null : value)),
  unknownSourceEnabled: z.coerce.boolean(),
  alertMinSeverity: z.enum(siemSeverities),
});

export async function getSiemAiSettings() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const [settings] = await db.select().from(siemSettings).limit(1);
  return {
    aiEnabled: settings?.aiEnabled ?? false,
    aiEndpointUrl: settings?.aiEndpointUrl ?? "",
    aiApiKeyConfigured: Boolean(settings?.aiApiKey?.trim() || process.env.SIEM_AI_API_KEY?.trim()),
    aiDefaultModel: settings?.aiDefaultModel ?? "",
    aiReady: Boolean((process.env.SIEM_AI_ENDPOINT_URL || settings?.aiEndpointUrl) && (process.env.SIEM_AI_DEFAULT_MODEL || settings?.aiDefaultModel)),
    aiMaxSampleEvents: settings?.aiMaxSampleEvents ?? 5,
    aiMaxRawLength: settings?.aiMaxRawLength ?? 2000,
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
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const [existing] = await db.select({ id: siemSettings.id, aiApiKey: siemSettings.aiApiKey }).from(siemSettings).limit(1);
  const values: Partial<typeof siemSettings.$inferInsert> = {
    aiEnabled: parsed.data.aiEnabled,
    aiEndpointUrl: parsed.data.aiEndpointUrl.trim(),
    aiDefaultModel: parsed.data.aiDefaultModel.trim(),
    aiMaxSampleEvents: parsed.data.aiMaxSampleEvents,
    aiMaxRawLength: parsed.data.aiMaxRawLength,
    updatedAt: new Date(),
  };
  if (parsed.data.aiApiKey?.trim()) values.aiApiKey = parsed.data.aiApiKey.trim();

  if (existing) await db.update(siemSettings).set(values).where(eq(siemSettings.id, existing.id));
  else await db.insert(siemSettings).values({ ...values, aiApiKey: values.aiApiKey ?? null });

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM AI", detail: "SIEM AI settings updated" });
  revalidatePath("/admin/settings");
  return { success: true };
}

export async function getSiemIngestSettings() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const [settings] = await db.select().from(siemSettings).limit(1);
  const siteRows = await db
    .select({ id: sites.id, name: sites.name, code: sites.code })
    .from(sites)
    .where(eq(sites.isActive, true))
    .orderBy(asc(sites.name));

  return {
    defaultSiemSiteId: settings?.defaultSiemSiteId ?? null,
    unknownSourceEnabled: settings?.unknownSourceEnabled ?? true,
    alertMinSeverity: (settings?.alertMinSeverity ?? "High") as (typeof siemSeverities)[number],
    sites: siteRows,
  };
}

export async function updateSiemIngestSettings(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = ingestSettingsSchema.safeParse({
    defaultSiemSiteId: formData.get("defaultSiemSiteId") ?? "",
    unknownSourceEnabled: formData.get("unknownSourceEnabled") === "true",
    alertMinSeverity: formData.get("alertMinSeverity"),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const [existing] = await db.select({ id: siemSettings.id }).from(siemSettings).limit(1);
  const values: Partial<typeof siemSettings.$inferInsert> = {
    defaultSiemSiteId: parsed.data.defaultSiemSiteId,
    unknownSourceEnabled: parsed.data.unknownSourceEnabled,
    alertMinSeverity: parsed.data.alertMinSeverity,
    updatedAt: new Date(),
  };

  if (existing) await db.update(siemSettings).set(values).where(eq(siemSettings.id, existing.id));
  else await db.insert(siemSettings).values(values);

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM Ingest", detail: "SIEM ingest settings updated" });
  revalidatePath("/admin/settings");
  return { success: true };
}

const SEVERITY_RANK: Record<(typeof siemSeverities)[number], number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

export async function getSiemRules() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const rules = await db
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
    .from(siemRules);

  rules.sort((a, b) =>
    a.category === b.category
      ? SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );

  const [settings] = await db.select({ alertMinSeverity: siemSettings.alertMinSeverity }).from(siemSettings).limit(1);

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
        .where(eq(siemRules.id, rule.id));
    }

    const [existing] = await tx.select({ id: siemSettings.id }).from(siemSettings).limit(1);
    if (existing) {
      await tx.update(siemSettings).set({ alertMinSeverity: parsed.alertMinSeverity, updatedAt: new Date() }).where(eq(siemSettings.id, existing.id));
    } else {
      await tx.insert(siemSettings).values({ alertMinSeverity: parsed.alertMinSeverity });
    }
  });

  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM Rules", detail: `Updated ${parsed.rules.length} rule(s), min severity ${parsed.alertMinSeverity}` });
  revalidatePath("/admin/siem/rules");
  return { success: true };
}
