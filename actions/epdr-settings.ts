"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { epdrSiteSettings } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { THREAT_CATEGORIES } from "@/lib/epdr/posture";

export type EpdrSiteSettingsData = {
  siteId: number;
  ingestEnabled: boolean;
  eventTypes: number[];
  threatsyncEnabled: boolean;
  threatsyncCategories: string[];
  threatsyncMinScore: number;
  threatsyncMaxScore: number;
  correlationWindowMinutes: number;
  reopenWindowDays: number;
  defaultAssigneeId: number | null;
  siteKillSwitch: boolean;
  breakerMaxActions: number;
  breakerWindowMinutes: number;
  breakerSameThreatEndpoints: number;
  healthEnabled: boolean;
  healthGraceMinutes: number;
  healthStageWaitHours: number;
  healthRebootMode: "off" | "approval" | "automatic";
  healthRebootCountdown: number;
  healthStableMinutes: number;
};

export async function getEpdrSettings(): Promise<EpdrSiteSettingsData | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const [row] = await db.select().from(epdrSiteSettings).where(eq(epdrSiteSettings.siteId, guard.activeSiteId)).limit(1);
  return {
    siteId: guard.activeSiteId,
    ingestEnabled: row?.ingestEnabled ?? false,
    eventTypes: row?.eventTypes ?? [1, 2, 4, 6, 18],
    threatsyncEnabled: row?.threatsyncEnabled ?? true,
    threatsyncCategories: row?.threatsyncCategories ?? [...THREAT_CATEGORIES],
    threatsyncMinScore: row?.threatsyncMinScore ?? 7,
    threatsyncMaxScore: row?.threatsyncMaxScore ?? 10,
    correlationWindowMinutes: row?.correlationWindowMinutes ?? 1440,
    reopenWindowDays: row?.reopenWindowDays ?? 7,
    defaultAssigneeId: row?.defaultAssigneeId ?? null,
    siteKillSwitch: row?.siteKillSwitch ?? false,
    breakerMaxActions: row?.breakerMaxActions ?? 20,
    breakerWindowMinutes: row?.breakerWindowMinutes ?? 15,
    breakerSameThreatEndpoints: row?.breakerSameThreatEndpoints ?? 5,
    healthEnabled: row?.healthEnabled ?? false,
    healthGraceMinutes: row?.healthGraceMinutes ?? 30,
    healthStageWaitHours: row?.healthStageWaitHours ?? 24,
    healthRebootMode: (row?.healthRebootMode as EpdrSiteSettingsData["healthRebootMode"]) ?? "approval",
    healthRebootCountdown: row?.healthRebootCountdown ?? 7,
    healthStableMinutes: row?.healthStableMinutes ?? 60,
  };
}

function bool(value: string | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

/**
 * Reads a checkbox group or a legacy comma-separated field. Both shapes
 * normalize identically, so the form can switch to checkboxes without
 * invalidating values typed into the old text input.
 */
function listValues(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .flatMap((v) => String(v).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function intValues(form: FormData, key: string): number[] {
  return listValues(form, key).map(Number).filter((n) => Number.isInteger(n));
}

const schema = z
  .object({
    ingestEnabled: z.boolean(),
    eventTypes: z.array(z.number().int()).min(1, "Pilih minimal satu jenis event."),
    threatsyncEnabled: z.boolean(),
    threatsyncCategories: z.array(z.string()).min(1, "Pilih minimal satu kategori."),
    threatsyncMinScore: z.coerce.number().int().min(1).max(10),
    threatsyncMaxScore: z.coerce.number().int().min(1).max(10),
    correlationWindowMinutes: z.coerce.number().int().min(5).max(10_000),
    reopenWindowDays: z.coerce.number().int().min(1).max(365),
    defaultAssigneeId: z.coerce.number().int().positive().nullable().optional(),
    siteKillSwitch: z.boolean(),
    breakerMaxActions: z.coerce.number().int().min(1).max(1000),
    breakerWindowMinutes: z.coerce.number().int().min(1).max(1440),
    breakerSameThreatEndpoints: z.coerce.number().int().min(1).max(1000),
    healthEnabled: z.boolean(),
    healthGraceMinutes: z.coerce.number().int().min(0).max(1440),
    healthStageWaitHours: z.coerce.number().int().min(1).max(720),
    healthRebootMode: z.enum(["off", "approval", "automatic"]),
    healthRebootCountdown: z.coerce.number().int().min(0).max(7),
    healthStableMinutes: z.coerce.number().int().min(5).max(1440),
  })
  .refine((d) => d.threatsyncMinScore <= d.threatsyncMaxScore, {
    message: "Skor minimum tidak boleh melebihi maksimum.",
  });

export async function saveEpdrSettings(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const defaultAssigneeRaw = String(formData.get("defaultAssigneeId") ?? "").trim();
  const parsed = schema.safeParse({
    ingestEnabled: bool(String(formData.get("ingestEnabled") ?? "")),
    eventTypes: intValues(formData, "eventTypes"),
    threatsyncEnabled: bool(String(formData.get("threatsyncEnabled") ?? "")),
    threatsyncCategories: listValues(formData, "threatsyncCategories").map((s) => s.toLowerCase()),
    threatsyncMinScore: String(formData.get("threatsyncMinScore") ?? "7"),
    threatsyncMaxScore: String(formData.get("threatsyncMaxScore") ?? "10"),
    correlationWindowMinutes: String(formData.get("correlationWindowMinutes") ?? "1440"),
    reopenWindowDays: String(formData.get("reopenWindowDays") ?? "7"),
    defaultAssigneeId: defaultAssigneeRaw === "" ? null : defaultAssigneeRaw,
    siteKillSwitch: bool(String(formData.get("siteKillSwitch") ?? "")),
    breakerMaxActions: String(formData.get("breakerMaxActions") ?? "20"),
    breakerWindowMinutes: String(formData.get("breakerWindowMinutes") ?? "15"),
    breakerSameThreatEndpoints: String(formData.get("breakerSameThreatEndpoints") ?? "5"),
    healthEnabled: bool(String(formData.get("healthEnabled") ?? "")),
    healthGraceMinutes: String(formData.get("healthGraceMinutes") ?? "30"),
    healthStageWaitHours: String(formData.get("healthStageWaitHours") ?? "24"),
    healthRebootMode: String(formData.get("healthRebootMode") ?? "approval"),
    healthRebootCountdown: String(formData.get("healthRebootCountdown") ?? "7"),
    healthStableMinutes: String(formData.get("healthStableMinutes") ?? "60"),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Pengaturan deteksi tidak valid." };
  }

  const d = parsed.data;
  const values = {
    ingestEnabled: d.ingestEnabled,
    eventTypes: d.eventTypes,
    threatsyncEnabled: d.threatsyncEnabled,
    threatsyncCategories: d.threatsyncCategories,
    threatsyncMinScore: d.threatsyncMinScore,
    threatsyncMaxScore: d.threatsyncMaxScore,
    correlationWindowMinutes: d.correlationWindowMinutes,
    reopenWindowDays: d.reopenWindowDays,
    defaultAssigneeId: d.defaultAssigneeId ?? null,
    siteKillSwitch: d.siteKillSwitch,
    breakerMaxActions: d.breakerMaxActions,
    breakerWindowMinutes: d.breakerWindowMinutes,
    breakerSameThreatEndpoints: d.breakerSameThreatEndpoints,
    healthEnabled: d.healthEnabled,
    healthGraceMinutes: d.healthGraceMinutes,
    healthStageWaitHours: d.healthStageWaitHours,
    healthRebootMode: d.healthRebootMode,
    healthRebootCountdown: d.healthRebootCountdown,
    healthStableMinutes: d.healthStableMinutes,
    updatedBy: guard.session.userId,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(epdrSiteSettings)
      .values({ siteId: guard.activeSiteId, ...values })
      .onConflictDoUpdate({ target: epdrSiteSettings.siteId, set: values });

    revalidatePath("/admin/epdr/settings");
    await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard EPDR Detection Settings", detail: "Site detection settings saved" });
    return { success: true, message: "Pengaturan disimpan." };
  } catch {
    return { message: "Terjadi kesalahan saat menyimpan pengaturan EPDR." };
  }
}
