"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import { epdrRules, watchguardGlobalSettings } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { isEpdrActionType } from "@/lib/epdr/action-types";

const EXECUTION_MODES = ["simulate", "approval", "automatic"] as const;
const CLOSE_MODES = ["auto", "approval", "manual"] as const;

export type EpdrRuleRow = {
  id: number;
  ruleKey: string;
  version: number;
  name: string;
  enabled: boolean;
  categories: string[];
  minScore: number | null;
  maxScore: number | null;
  deviceTypes: number[];
  actionType: string;
  executionMode: string;
  closeMode: string;
  observationMinutes: number;
  cooldownMinutes: number;
  priority: number;
  simulateSince: Date | null;
  pendingMode: string | null;
  pendingModeRequestedBy: number | null;
};

export async function getEpdrRules(): Promise<EpdrRuleRow[] | { message: string }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const rows = await db
    .select()
    .from(epdrRules)
    .where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.isCurrent, true)))
    .orderBy(desc(epdrRules.priority));

  return rows.map((r) => ({
    id: r.id,
    ruleKey: r.ruleKey,
    version: r.version,
    name: r.name,
    enabled: r.enabled,
    categories: r.categories,
    minScore: r.minScore,
    maxScore: r.maxScore,
    deviceTypes: r.deviceTypes,
    actionType: r.actionType,
    executionMode: r.executionMode,
    closeMode: r.closeMode,
    observationMinutes: r.observationMinutes,
    cooldownMinutes: r.cooldownMinutes,
    priority: r.priority,
    simulateSince: r.simulateSince,
    pendingMode: r.pendingMode,
    pendingModeRequestedBy: r.pendingModeRequestedBy,
  }));
}

function parseBool(value: string | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

const ruleSchema = z.object({
  ruleKey: z.string().max(64),
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  categories: z.array(z.string()).min(1),
  minScore: z.coerce.number().int().min(1).max(10).nullable().optional(),
  maxScore: z.coerce.number().int().min(1).max(10).nullable().optional(),
  deviceTypes: z.array(z.number().int()).min(1),
  actionType: z.string().refine(isEpdrActionType, { message: "Jenis aksi tidak valid." }),
  closeMode: z.enum(CLOSE_MODES),
  observationMinutes: z.coerce.number().int().min(5).max(10_000),
  cooldownMinutes: z.coerce.number().int().min(0).max(10_000),
  priority: z.coerce.number().int().min(1).max(10_000),
});

export async function saveEpdrRule(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const minRaw = String(formData.get("minScore") ?? "").trim();
  const maxRaw = String(formData.get("maxScore") ?? "").trim();

  const parsed = ruleSchema.safeParse({
    ruleKey: String(formData.get("ruleKey") ?? ""),
    name: String(formData.get("name") ?? ""),
    enabled: parseBool(String(formData.get("enabled") ?? "")),
    categories: String(formData.get("categories") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    minScore: minRaw === "" ? null : minRaw,
    maxScore: maxRaw === "" ? null : maxRaw,
    deviceTypes: String(formData.get("deviceTypes") ?? "1,2").split(",").map((v) => Number(v.trim())).filter((n) => Number.isInteger(n)),
    actionType: String(formData.get("actionType") ?? "scan"),
    closeMode: String(formData.get("closeMode") ?? "manual"),
    observationMinutes: String(formData.get("observationMinutes") ?? "30"),
    cooldownMinutes: String(formData.get("cooldownMinutes") ?? "240"),
    priority: String(formData.get("priority") ?? "100"),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Aturan tidak valid." };
  }
  const d = parsed.data;
  if (d.minScore != null && d.maxScore != null && d.minScore > d.maxScore) {
    return { message: "Skor minimum tidak boleh melebihi maksimum." };
  }

  try {
    const siteId = guard.activeSiteId;
    const ruleKey = d.ruleKey || randomUUID();

    // Flip the previous current version for this rule key.
    if (d.ruleKey) {
      await db.update(epdrRules).set({ isCurrent: false }).where(and(eq(epdrRules.siteId, siteId), eq(epdrRules.ruleKey, ruleKey), eq(epdrRules.isCurrent, true)));
      const latest = await db
        .select({ version: epdrRules.version })
        .from(epdrRules)
        .where(and(eq(epdrRules.siteId, siteId), eq(epdrRules.ruleKey, ruleKey)))
        .orderBy(desc(epdrRules.version))
        .limit(1);
      const version = (latest[0]?.version ?? 0) + 1;

      await db.insert(epdrRules).values({
        siteId,
        ruleKey,
        version,
        isCurrent: true,
        name: d.name,
        enabled: d.enabled,
        trigger: "detection",
        categories: d.categories,
        minScore: d.minScore,
        maxScore: d.maxScore,
        deviceTypes: d.deviceTypes,
        actionType: d.actionType,
        actionParams: { scanScope: 0, windowHours: 24 },
        executionMode: "simulate", // edits reset to simulate (material change invalidates qualification)
        closeMode: d.closeMode,
        observationMinutes: d.observationMinutes,
        cooldownMinutes: d.cooldownMinutes,
        priority: d.priority,
        createdBy: guard.session.userId,
        createdAt: new Date(),
      });
    } else {
      await db.insert(epdrRules).values({
        siteId,
        ruleKey,
        version: 1,
        isCurrent: true,
        name: d.name,
        enabled: d.enabled,
        trigger: "detection",
        categories: d.categories,
        minScore: d.minScore,
        maxScore: d.maxScore,
        deviceTypes: d.deviceTypes,
        actionType: d.actionType,
        actionParams: { scanScope: 0, windowHours: 24 },
        executionMode: "simulate",
        closeMode: d.closeMode,
        observationMinutes: d.observationMinutes,
        cooldownMinutes: d.cooldownMinutes,
        priority: d.priority,
        simulateSince: new Date(),
        createdBy: guard.session.userId,
        createdAt: new Date(),
      });
    }

    revalidatePath("/admin/epdr/settings");
    await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard EPDR Rule", detail: "Rule saved" });
    return { success: true, message: "Aturan disimpan." };
  } catch {
    return { message: "Terjadi kesalahan saat menyimpan aturan." };
  }
}

const modeSchema = z.object({ ruleKey: z.string().min(1).max(64), rulesVersion: z.coerce.number().int().positive() });

export async function requestAutomaticMode(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const parsed = modeSchema.safeParse({ ruleKey: String(formData.get("ruleKey") ?? ""), rulesVersion: String(formData.get("rulesVersion") ?? "") });
  if (!parsed.success) return { message: "Input tidak valid." };

  const [global] = await db.select({ simulationMinDays: watchguardGlobalSettings.simulationMinDays }).from(watchguardGlobalSettings).limit(1);
  const minDays = global?.simulationMinDays ?? 7;

  const [rule] = await db.select().from(epdrRules)
    .where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.ruleKey, parsed.data.ruleKey), eq(epdrRules.isCurrent, true)))
    .limit(1);

  if (!rule || rule.version !== parsed.data.rulesVersion) return { message: "Versi aturan berubah; muat ulang dan coba lagi." };
  if (rule.executionMode !== "simulate") return { message: "Hanya aturan simulasi yang bisa meminta mode otomatis." };
  if (!rule.simulateSince) return { message: "Aturan belum memulai simulasi." };

  const qualifiedForMs = Date.now() - rule.simulateSince.getTime() >= minDays * 24 * 60 * 60 * 1000;
  if (!qualifiedForMs) return { message: `Simulasi minimum ${minDays} hari belum terpenuhi.` };

  await db.update(epdrRules).set({ pendingMode: "automatic", pendingModeRequestedBy: guard.session.userId, pendingModeRequestedAt: new Date() }).where(eq(epdrRules.id, rule.id));
  revalidatePath("/admin/epdr/settings");
  return { success: true, message: "Permintaan mode otomatis diajukan; admin lain harus mengonfirmasi." };
}

export async function confirmAutomaticMode(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const parsed = modeSchema.safeParse({ ruleKey: String(formData.get("ruleKey") ?? ""), rulesVersion: String(formData.get("rulesVersion") ?? "") });
  if (!parsed.success) return { message: "Input tidak valid." };

  const [rule] = await db.select().from(epdrRules)
    .where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.ruleKey, parsed.data.ruleKey), eq(epdrRules.isCurrent, true)))
    .limit(1);

  if (!rule || rule.version !== parsed.data.rulesVersion) return { message: "Versi aturan berubah; muat ulang dan coba lagi." };
  if (rule.pendingMode !== "automatic") return { message: "Tidak ada permintaan mode otomatis yang tertunda." };
  if (rule.pendingModeRequestedBy === guard.session.userId) return { message: "Anda tidak dapat mengonfirmasi permintaan sendiri." };

  // New version flips execution_mode to automatic and clears pending (CAS on version).
  await db.update(epdrRules).set({ isCurrent: false }).where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.ruleKey, parsed.data.ruleKey), eq(epdrRules.isCurrent, true)));
  await db.insert(epdrRules).values({
    siteId: guard.activeSiteId,
    ruleKey: parsed.data.ruleKey,
    version: rule.version + 1,
    isCurrent: true,
    name: rule.name,
    enabled: rule.enabled,
    trigger: rule.trigger,
    categories: rule.categories,
    minScore: rule.minScore,
    maxScore: rule.maxScore,
    deviceTypes: rule.deviceTypes,
    actionType: rule.actionType,
    actionParams: rule.actionParams,
    executionMode: "automatic",
    closeMode: rule.closeMode,
    observationMinutes: rule.observationMinutes,
    cooldownMinutes: rule.cooldownMinutes,
    priority: rule.priority,
    simulateSince: rule.simulateSince,
    createdBy: rule.createdBy,
    createdAt: new Date(),
  });

  revalidatePath("/admin/epdr/settings");
  await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard EPDR Rule", detail: "Automatic mode confirmed" });
  return { success: true, message: "Mode otomatis diaktifkan." };
}

export async function rejectAutomaticMode(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const parsed = modeSchema.safeParse({ ruleKey: String(formData.get("ruleKey") ?? ""), rulesVersion: String(formData.get("rulesVersion") ?? "") });
  if (!parsed.success) return { message: "Input tidak valid." };

  const [rule] = await db.select().from(epdrRules)
    .where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.ruleKey, parsed.data.ruleKey), eq(epdrRules.isCurrent, true)))
    .limit(1);

  if (!rule || rule.pendingMode !== "automatic") return { message: "Tidak ada permintaan tertunda." };
  await db.update(epdrRules).set({ pendingMode: null, pendingModeRequestedBy: null, pendingModeRequestedAt: null }).where(eq(epdrRules.id, rule.id));
  revalidatePath("/admin/epdr/settings");
  return { success: true, message: "Permintaan mode otomatis ditolak." };
}