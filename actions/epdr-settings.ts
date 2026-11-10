"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { epdrSiteSettings } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";

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
    threatsyncCategories: row?.threatsyncCategories ?? ["malware", "pup", "virus", "exploit", "ioa"],
    threatsyncMinScore: row?.threatsyncMinScore ?? 7,
    threatsyncMaxScore: row?.threatsyncMaxScore ?? 10,
    correlationWindowMinutes: row?.correlationWindowMinutes ?? 1440,
    reopenWindowDays: row?.reopenWindowDays ?? 7,
    defaultAssigneeId: row?.defaultAssigneeId ?? null,
    siteKillSwitch: row?.siteKillSwitch ?? false,
  };
}

function bool(value: string | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

function intList(value: string): number[] {
  return value.split(",").map((v) => Number(v.trim())).filter((n) => Number.isInteger(n));
}

const schema = z.object({
  ingestEnabled: z.boolean(),
  eventTypes: z.array(z.number().int()).min(1),
  threatsyncEnabled: z.boolean(),
  threatsyncCategories: z.array(z.string()).min(1),
  threatsyncMinScore: z.coerce.number().int().min(1).max(10),
  threatsyncMaxScore: z.coerce.number().int().min(1).max(10),
  correlationWindowMinutes: z.coerce.number().int().min(5).max(10_000),
  reopenWindowDays: z.coerce.number().int().min(1).max(365),
  defaultAssigneeId: z.coerce.number().int().positive().nullable().optional(),
  siteKillSwitch: z.boolean(),
}).refine((d) => d.threatsyncMinScore <= d.threatsyncMaxScore, {
  message: "Skor minimum tidak boleh melebihi maksimum.",
});

export async function saveEpdrSettings(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const defaultAssigneeRaw = String(formData.get("defaultAssigneeId") ?? "").trim();
  const parsed = schema.safeParse({
    ingestEnabled: bool(String(formData.get("ingestEnabled") ?? "")),
    eventTypes: intList(String(formData.get("eventTypes") ?? "1,2,4,6,18")),
    threatsyncEnabled: bool(String(formData.get("threatsyncEnabled") ?? "")),
    threatsyncCategories: String(formData.get("threatsyncCategories") ?? "malware,pup,virus,exploit,ioa").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    threatsyncMinScore: String(formData.get("threatsyncMinScore") ?? "7"),
    threatsyncMaxScore: String(formData.get("threatsyncMaxScore") ?? "10"),
    correlationWindowMinutes: String(formData.get("correlationWindowMinutes") ?? "1440"),
    reopenWindowDays: String(formData.get("reopenWindowDays") ?? "7"),
    defaultAssigneeId: defaultAssigneeRaw === "" ? null : defaultAssigneeRaw,
    siteKillSwitch: bool(String(formData.get("siteKillSwitch") ?? "")),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Pengaturan deteksi tidak valid." };
  }

  const d = parsed.data;
  try {
    await db
      .insert(epdrSiteSettings)
      .values({
        siteId: guard.activeSiteId,
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
        updatedBy: guard.session.userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: epdrSiteSettings.siteId,
        set: {
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
          updatedBy: guard.session.userId,
          updatedAt: new Date(),
        },
      });

    revalidatePath("/admin/epdr/settings");
    await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard EPDR Detection Settings", detail: "Site detection settings saved" });
    return { success: true, message: "Pengaturan deteksi EPDR disimpan." };
  } catch {
    return { message: "Terjadi kesalahan saat menyimpan pengaturan deteksi EPDR." };
  }
}