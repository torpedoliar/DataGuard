"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import { epdrRules } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { isEpdrActionType } from "@/lib/epdr/action-types";
import { THREAT_CATEGORIES } from "@/lib/epdr/posture";

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
  ruleKey: z.string().trim().max(64),
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  categories: z.array(z.enum(THREAT_CATEGORIES)).min(1),
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

    await db.transaction(async (tx) => {
      await lockRuleActor(tx, siteId, guard.session.userId);
      const latest = await tx.select({ version: epdrRules.version }).from(epdrRules)
        .where(and(eq(epdrRules.siteId, siteId), eq(epdrRules.ruleKey, ruleKey)))
        .orderBy(desc(epdrRules.version)).limit(1);
      // An edit must target a rule owned by this site, never create a foreign key here.
      if (d.ruleKey && !latest[0]) throw new Error("rule_unavailable");
      await tx.update(epdrRules).set({ isCurrent: false }).where(and(
        eq(epdrRules.siteId, siteId), eq(epdrRules.ruleKey, ruleKey), eq(epdrRules.isCurrent, true),
      ));
      await tx.insert(epdrRules).values({
        siteId,
        ruleKey,
        version: (latest[0]?.version ?? 0) + 1,
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
    });

    revalidatePath("/admin/epdr/settings");
    await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard EPDR Rule", detail: "Rule saved" });
    return { success: true, message: "Aturan disimpan." };
  } catch {
    return { message: "Terjadi kesalahan saat menyimpan aturan." };
  }
}

type RuleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serialize all rule publications for a site, including first versions. */
async function lockRuleActor(tx: RuleTransaction, siteId: number, actorId: number) {
  const { rows: sites } = await tx.execute(sql`SELECT id FROM sites
    WHERE id = ${siteId} AND is_active = true FOR UPDATE`);
  if (!sites[0]) throw new Error("site_unavailable");
  const { rows: actors } = await tx.execute<{ role: string }>(sql`SELECT role FROM users
    WHERE id = ${actorId} AND is_active = true FOR SHARE`);
  if (!actors[0]) throw new Error("actor_unavailable");
  if (actors[0].role === "superadmin") return;
  const { rows: memberships } = await tx.execute(sql`SELECT id FROM user_sites
    WHERE user_id = ${actorId} AND site_id = ${siteId} AND role_in_site = 'admin' FOR SHARE`);
  if (!memberships[0]) throw new Error("membership_revoked");
}

const modeSchema = z.object({ ruleKey: z.string().trim().min(1).max(64), rulesVersion: z.coerce.number().int().positive() });

async function blockAutomaticMode(formData: FormData) {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };
  const parsed = modeSchema.safeParse({ ruleKey: String(formData.get("ruleKey") ?? ""), rulesVersion: String(formData.get("rulesVersion") ?? "") });
  if (!parsed.success) return { message: "Input tidak valid." };
  // READ_ONLY is binding: neither simulation qualification nor another admin's
  // approval can unlock provider writes. Do not persist a misleading mode/request.
  return { status: "blocked_read_only" as const, message: "Mode otomatis diblokir oleh kebijakan READ_ONLY. Persetujuan admin tidak dapat mengaktifkannya; aturan tetap dalam mode simulasi." };
}

export async function requestAutomaticMode(prevState: unknown, formData: FormData) {
  void prevState;
  return blockAutomaticMode(formData);
}

export async function confirmAutomaticMode(prevState: unknown, formData: FormData) {
  void prevState;
  return blockAutomaticMode(formData);
}

export async function rejectAutomaticMode(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { message: guard.message };

  const parsed = modeSchema.safeParse({ ruleKey: String(formData.get("ruleKey") ?? ""), rulesVersion: String(formData.get("rulesVersion") ?? "") });
  if (!parsed.success) return { message: "Input tidak valid." };

  try {
    const rejected = await db.transaction(async (tx) => {
      await lockRuleActor(tx, guard.activeSiteId, guard.session.userId);
      const [rule] = await tx.select().from(epdrRules)
        .where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.ruleKey, parsed.data.ruleKey), eq(epdrRules.isCurrent, true)))
        .limit(1);
      if (!rule || rule.version !== parsed.data.rulesVersion || rule.pendingMode !== "automatic") return false;
      await tx.update(epdrRules).set({ pendingMode: null, pendingModeRequestedBy: null, pendingModeRequestedAt: null })
        .where(and(eq(epdrRules.siteId, guard.activeSiteId), eq(epdrRules.id, rule.id), eq(epdrRules.version, parsed.data.rulesVersion), eq(epdrRules.isCurrent, true)));
      return true;
    });
    if (!rejected) return { message: "Tidak ada permintaan tertunda atau versi aturan berubah." };
    revalidatePath("/admin/epdr/settings");
    return { success: true, message: "Permintaan mode otomatis ditolak." };
  } catch {
    return { message: "Terjadi kesalahan saat menolak permintaan." };
  }
}
