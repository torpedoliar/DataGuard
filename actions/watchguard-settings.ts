"use server";

import { asc, eq, ne, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { sites, watchguardConnections, watchguardGlobalSettings } from "@/db/schema";
import { requireSuperadminAction } from "@/lib/action-auth";
import { encryptString } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { WATCHGUARD_REGIONS } from "@/lib/watchguard/regions";
import { testConnection, type ServiceChecks } from "@/lib/watchguard/connection";
import { isEpdrActionType } from "@/lib/epdr/action-types";

const REGIONS = Object.keys(WATCHGUARD_REGIONS) as Array<keyof typeof WATCHGUARD_REGIONS>;

export type WatchGuardSiteConfig = {
  siteId: number;
  siteName: string;
  configured: boolean;
  enabled: boolean;
  region: string | null;
  accountId: string;
  apiKeyConfigured: boolean;
  rwConfigured: boolean;
  roConfigured: boolean;
  endpointSyncMinutes: number;
  detectionSyncMinutes: number;
  credentialRevision: number;
  accountRevision: number;
  lastTestAt: Date | null;
  lastTestResult: unknown;
};

export type WatchGuardGlobalConfig = {
  killSwitch: boolean;
  allowedActions: string[];
  maxActionsPerHourPerSite: number;
  simulationMinDays: number;
  autoCloseCategories: string[];
  autoCloseMaxScore: number;
  approvalExpiryHours: number;
  exclusionMaxDays: number;
};

export type WatchGuardSettingsData = {
  global: WatchGuardGlobalConfig;
  sites: WatchGuardSiteConfig[];
};

export async function getWatchGuardSettings(): Promise<WatchGuardSettingsData | { message: string }> {
  if (process.env.npm_lifecycle_event === "build") return { message: "Build" };

  const guard = await requireSuperadminAction();
  if (!guard.ok) return { message: guard.message };

  try {
    const [siteList, rows, [global]] = await Promise.all([
      db.select({ id: sites.id, name: sites.name }).from(sites).orderBy(asc(sites.name)),
      db.select().from(watchguardConnections),
      db.select().from(watchguardGlobalSettings).limit(1),
    ]);

    const bySite = new Map(rows.map((row) => [row.siteId, row]));

    const siteConfigs: WatchGuardSiteConfig[] = siteList.map((site) => {
      const row = bySite.get(site.id);
      return {
        siteId: site.id,
        siteName: site.name,
        configured: Boolean(row),
        enabled: row?.enabled ?? false,
        region: row?.region ?? null,
        accountId: row?.accountId ?? "",
        apiKeyConfigured: Boolean(row?.apiKey),
        rwConfigured: Boolean(row?.rwAccessId && row?.rwPassword),
        roConfigured: Boolean(row?.roAccessId && row?.roPassword),
        endpointSyncMinutes: row?.endpointSyncMinutes ?? 15,
        detectionSyncMinutes: row?.detectionSyncMinutes ?? 5,
        credentialRevision: row?.credentialRevision ?? 0,
        accountRevision: row?.accountRevision ?? 0,
        lastTestAt: row?.lastTestAt ?? null,
        lastTestResult: row?.lastTestResult ?? null,
      };
    });

    const g = global;
    return {
      global: {
        killSwitch: g?.killSwitch ?? false,
        allowedActions: g?.allowedActions ?? ["scan"],
        maxActionsPerHourPerSite: g?.maxActionsPerHourPerSite ?? 30,
        simulationMinDays: g?.simulationMinDays ?? 7,
        autoCloseCategories: g?.autoCloseCategories ?? ["malware", "pup"],
        autoCloseMaxScore: g?.autoCloseMaxScore ?? 6,
        approvalExpiryHours: g?.approvalExpiryHours ?? 24,
        exclusionMaxDays: g?.exclusionMaxDays ?? 90,
      },
      sites: siteConfigs,
    };
  } catch {
    return { message: "Could not load WatchGuard settings." };
  }
}

function parseBool(value: string | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

const connectionSchema = z.object({
  siteId: z.coerce.number().int().positive(),
  enabled: z.boolean(),
  region: z.enum(REGIONS, { message: "Region tidak valid." }),
  accountId: z.string().trim().min(1, "Account ID wajib diisi.").max(200),
  apiKey: z.string().max(500),
  rwAccessId: z.string().max(200),
  rwPassword: z.string().max(500),
  roAccessId: z.string().max(200),
  roPassword: z.string().max(500),
  endpointSyncMinutes: z.coerce.number().int(),
  detectionSyncMinutes: z.coerce.number().int(),
});

export async function saveWatchGuardConnection(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireSuperadminAction();
  if (!guard.ok) return { message: guard.message };

  const parsed = connectionSchema.safeParse({
    siteId: String(formData.get("watchguardSiteId") ?? ""),
    enabled: parseBool(String(formData.get("watchguardEnabled") ?? "")),
    region: String(formData.get("watchguardRegion") ?? ""),
    accountId: String(formData.get("watchguardAccountId") ?? ""),
    apiKey: String(formData.get("watchguardApiKey") ?? ""),
    rwAccessId: String(formData.get("watchguardRwAccessId") ?? ""),
    rwPassword: String(formData.get("watchguardRwPassword") ?? ""),
    roAccessId: String(formData.get("watchguardRoAccessId") ?? ""),
    roPassword: String(formData.get("watchguardRoPassword") ?? ""),
    endpointSyncMinutes: String(formData.get("watchguardEndpointSyncMinutes") ?? "15"),
    detectionSyncMinutes: String(formData.get("watchguardDetectionSyncMinutes") ?? "5"),
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid.";
    return { message: firstIssue, errors: parsed.error.flatten().fieldErrors };
  }

  const d = parsed.data;

  // Reject out-of-range intervals with a clear message (never silently clamp).
  if (d.endpointSyncMinutes < 5 || d.endpointSyncMinutes > 1440) {
    return { message: "Interval sinkronisasi endpoint harus 5–1440 menit." };
  }
  if (d.detectionSyncMinutes < 2 || d.detectionSyncMinutes > 60) {
    return { message: "Interval sinkronisasi deteksi harus 2–60 menit." };
  }

  try {
    // One binding per (region, account_id) across sites (CONTRACTS C1).
    const clash = await db
      .select({ id: watchguardConnections.id })
      .from(watchguardConnections)
      .where(and(ne(watchguardConnections.siteId, d.siteId), eq(watchguardConnections.region, d.region), eq(watchguardConnections.accountId, d.accountId)))
      .limit(1);
    if (clash.length > 0) {
      return { message: "Kombinasi region + Account ID sudah dipakai site lain." };
    }

    const [existing] = await db.select().from(watchguardConnections).where(eq(watchguardConnections.siteId, d.siteId)).limit(1);

    const accountChanged = !existing || existing.region !== d.region || existing.accountId !== d.accountId;
    const credentialChanged =
      !existing ||
      (d.apiKey !== "") ||
      (d.rwPassword !== "") ||
      (d.roPassword !== "") ||
      (d.rwAccessId !== (existing.rwAccessId ?? "")) ||
      (d.roAccessId !== (existing.roAccessId ?? ""));

    const values = {
      enabled: d.enabled,
      region: d.region,
      accountId: d.accountId,
      endpointSyncMinutes: d.endpointSyncMinutes,
      detectionSyncMinutes: d.detectionSyncMinutes,
      rwAccessId: d.rwAccessId !== "" ? d.rwAccessId : existing?.rwAccessId ?? null,
      roAccessId: d.roAccessId !== "" ? d.roAccessId : existing?.roAccessId ?? null,
      apiKey: d.apiKey !== "" ? encryptString(d.apiKey) : existing?.apiKey ?? null,
      rwPassword: d.rwPassword !== "" ? encryptString(d.rwPassword) : existing?.rwPassword ?? null,
      roPassword: d.roPassword !== "" ? encryptString(d.roPassword) : existing?.roPassword ?? null,
      credentialRevision: credentialChanged ? (existing?.credentialRevision ?? 0) + 1 : (existing?.credentialRevision ?? 0),
      accountRevision: accountChanged ? (existing?.accountRevision ?? 0) + 1 : (existing?.accountRevision ?? 0),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(watchguardConnections).set(values).where(eq(watchguardConnections.id, existing.id));
    } else {
      await db.insert(watchguardConnections).values({ siteId: d.siteId, ...values });
    }

    revalidatePath("/admin/settings");
    await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard Connection", entityId: d.siteId, detail: "Per-site WatchGuard connection saved" });
    return { success: true, message: "Koneksi WatchGuard disimpan." };
  } catch {
    return { message: "Terjadi kesalahan saat menyimpan pengaturan WatchGuard." };
  }
}

const clearSchema = z.object({ siteId: z.coerce.number().int().positive() });

export async function clearWatchGuardSecrets(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireSuperadminAction();
  if (!guard.ok) return { message: guard.message };

  const parsed = clearSchema.safeParse({ siteId: String(formData.get("watchguardSiteId") ?? "") });
  if (!parsed.success) return { message: "Site ID tidak valid." };

  try {
    const siteId = parsed.data.siteId;
    const [existing] = await db.select().from(watchguardConnections).where(eq(watchguardConnections.siteId, siteId)).limit(1);
    if (!existing) return { message: "Belum ada koneksi untuk site ini." };

    await db
      .update(watchguardConnections)
      .set({ apiKey: null, rwPassword: null, roPassword: null, credentialRevision: existing.credentialRevision + 1, updatedAt: new Date() })
      .where(eq(watchguardConnections.id, existing.id));

    revalidatePath("/admin/settings");
    await logAudit({ action: "DELETE", entity: "settings", entityName: "WatchGuard Connection", entityId: siteId, detail: "WatchGuard secrets cleared" });
    return { success: true, message: "Kredensial WatchGuard dihapus." };
  } catch {
    return { message: "Terjadi kesalahan saat menghapus kredensial WatchGuard." };
  }
}

export async function testWatchGuardConnection(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireSuperadminAction();
  if (!guard.ok) return { ok: false, message: guard.message };

  const parsed = clearSchema.safeParse({ siteId: String(formData.get("watchguardSiteId") ?? "") });
  if (!parsed.success) return { ok: false, message: "Site ID tidak valid." };

  const siteId = parsed.data.siteId;
  const [row] = await db.select().from(watchguardConnections).where(eq(watchguardConnections.siteId, siteId)).limit(1);
  if (!row) return { ok: false, message: "Belum ada koneksi: simpan dulu (boleh dalam keadaan nonaktif/draft)." };

  try {
    const result = await testConnection(siteId);

    const summary = toTestSummary(result);
    await db
      .update(watchguardConnections)
      .set({ lastTestAt: new Date(), lastTestResult: safeJson(result), updatedAt: new Date() })
      .where(eq(watchguardConnections.id, row.id));

    revalidatePath("/admin/settings");
    await logAudit({ action: "TEST", entity: "settings", entityName: "WatchGuard Connection", entityId: siteId, detail: "Per-service connection test" });

    return { ok: "configured" in result && result.configured ? isAllOk(result) : false, message: summary };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Tes koneksi gagal." };
  }
}

function isAllOk(result: { read?: ServiceChecks; write?: ServiceChecks }): boolean {
  const all = (checks?: ServiceChecks) => checks && Object.values(checks).every((s) => s.ok);
  return Boolean(all(result.read) && (!result.write || all(result.write)));
}

function toTestSummary(result: Awaited<ReturnType<typeof testConnection>>): string {
  if (!("configured" in result) || !result.configured) {
    return "Tidak dapat mengetes: koneksi belum layak.";
  }
  const parts: string[] = [];
  const addChecks = (label: string, checks: ServiceChecks) => {
    for (const [svc, s] of Object.entries(checks)) {
      parts.push(`${label}:${svc}=${s.ok ? "OK" : `gagal(${s.kind})`}`);
    }
  };
  if (result.read) addChecks("RO", result.read);
  if (result.write) addChecks("RW", result.write);
  return parts.join(" · ") || "Semua layanan OK";
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

// ---- Global settings -------------------------------------------------------

const globalSchema = z.object({
  killSwitch: z.boolean(),
  allowedActions: z.array(z.string()).min(1),
  maxActionsPerHourPerSite: z.coerce.number().int().min(1).max(10_000),
  simulationMinDays: z.coerce.number().int().min(0).max(3650),
  autoCloseCategories: z.array(z.string()),
  autoCloseMaxScore: z.coerce.number().int().min(0).max(10),
  approvalExpiryHours: z.coerce.number().int().min(1).max(24 * 30),
  exclusionMaxDays: z.coerce.number().int().min(1).max(365),
});

export async function saveWatchGuardGlobal(prevState: unknown, formData: FormData) {
  void prevState;
  const guard = await requireSuperadminAction();
  if (!guard.ok) return { message: guard.message };

  const allowedActions = formData.getAll("watchguardAllowedActions").map(String).filter(Boolean);
  const unknownActions = allowedActions.filter((a) => !isEpdrActionType(a));
  if (unknownActions.length > 0) {
    return { message: "Aksi tidak dikenal: " + unknownActions.join(", ") };
  }
  const autoCloseCategories = formData.getAll("watchguardAutoCloseCategories").map(String).map((s) => s.trim()).filter(Boolean);

  const parsed = globalSchema.safeParse({
    killSwitch: parseBool(String(formData.get("watchguardKillSwitch") ?? "")),
    allowedActions,
    maxActionsPerHourPerSite: String(formData.get("watchguardMaxActionsPerHour") ?? "30"),
    simulationMinDays: String(formData.get("watchguardSimulationMinDays") ?? "7"),
    autoCloseCategories,
    autoCloseMaxScore: String(formData.get("watchguardAutoCloseMaxScore") ?? "6"),
    approvalExpiryHours: String(formData.get("watchguardApprovalExpiryHours") ?? "24"),
    exclusionMaxDays: String(formData.get("watchguardExclusionMaxDays") ?? "90"),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Pengaturan global tidak valid." };
  }

  const d = parsed.data;

  try {
    await db
      .insert(watchguardGlobalSettings)
      .values({
        id: 1,
        killSwitch: d.killSwitch,
        allowedActions: d.allowedActions,
        maxActionsPerHourPerSite: d.maxActionsPerHourPerSite,
        simulationMinDays: d.simulationMinDays,
        autoCloseCategories: d.autoCloseCategories,
        autoCloseMaxScore: d.autoCloseMaxScore,
        approvalExpiryHours: d.approvalExpiryHours,
        exclusionMaxDays: d.exclusionMaxDays,
        updatedBy: guard.session.userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: watchguardGlobalSettings.id,
        set: {
          killSwitch: d.killSwitch,
          allowedActions: d.allowedActions,
          maxActionsPerHourPerSite: d.maxActionsPerHourPerSite,
          simulationMinDays: d.simulationMinDays,
          autoCloseCategories: d.autoCloseCategories,
          autoCloseMaxScore: d.autoCloseMaxScore,
          approvalExpiryHours: d.approvalExpiryHours,
          exclusionMaxDays: d.exclusionMaxDays,
          updatedBy: guard.session.userId,
          updatedAt: new Date(),
        },
      });

    revalidatePath("/admin/settings");
    await logAudit({ action: "UPDATE", entity: "settings", entityName: "WatchGuard Global", detail: "Global WatchGuard controls saved" });
    return { success: true, message: "Pengaturan global WatchGuard disimpan." };
  } catch {
    return { message: "Terjadi kesalahan saat menyimpan pengaturan global WatchGuard." };
  }
}