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

  // Display masks are never credentials, including submissions from older clients.
  if ([d.apiKey, d.rwAccessId, d.rwPassword, d.roAccessId, d.roPassword]
    .some((value) => /^[*•●]+$/u.test(value.trim()))) {
    return { message: "Masukkan kredensial baru atau kosongkan untuk mempertahankan nilai tersimpan." };
  }

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

    // A different access ID must never inherit the old identity's password.
    if ((d.rwAccessId !== "" && d.rwAccessId !== existing?.rwAccessId && d.rwPassword === "") ||
        (d.roAccessId !== "" && d.roAccessId !== existing?.roAccessId && d.roPassword === "")) {
      return { message: "Password baru wajib diisi saat mengganti Access ID RO/RW." };
    }

    // Blank fields preserve stored values; validate each effective pair so a
    // partial RO pair cannot accidentally fall back to an unrelated RW secret.
    const rwAccessId = d.rwAccessId !== "" ? d.rwAccessId : existing?.rwAccessId ?? null;
    const roAccessId = d.roAccessId !== "" ? d.roAccessId : existing?.roAccessId ?? null;
    const rwPasswordPresent = Boolean(d.rwPassword || existing?.rwPassword);
    const roPasswordPresent = Boolean(d.roPassword || existing?.roPassword);
    if (Boolean(rwAccessId) !== rwPasswordPresent || Boolean(roAccessId) !== roPasswordPresent) {
      return { message: "Access ID dan password harus diisi berpasangan untuk kredensial RO/RW." };
    }

    const accountChanged = !existing || existing.region !== d.region || existing.accountId !== d.accountId;
    const credentialChanged =
      !existing ||
      (d.apiKey !== "") ||
      (d.rwPassword !== "") ||
      (d.roPassword !== "") ||
      (rwAccessId !== (existing.rwAccessId ?? null)) ||
      (roAccessId !== (existing.roAccessId ?? null));

    const values = {
      enabled: d.enabled,
      region: d.region,
      accountId: d.accountId,
      endpointSyncMinutes: d.endpointSyncMinutes,
      detectionSyncMinutes: d.detectionSyncMinutes,
      rwAccessId,
      roAccessId,
      apiKey: d.apiKey !== "" ? encryptString(d.apiKey) : existing?.apiKey ?? null,
      rwPassword: d.rwPassword !== "" ? encryptString(d.rwPassword) : existing?.rwPassword ?? null,
      roPassword: d.roPassword !== "" ? encryptString(d.roPassword) : existing?.roPassword ?? null,
      credentialRevision: credentialChanged ? (existing?.credentialRevision ?? 0) + 1 : (existing?.credentialRevision ?? 0),
      accountRevision: accountChanged ? (existing?.accountRevision ?? 0) + 1 : (existing?.accountRevision ?? 0),
      ...(accountChanged || credentialChanged ? { lastTestAt: null, lastTestResult: null } : {}),
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
      .set({
        enabled: false,
        apiKey: null,
        rwAccessId: null,
        rwPassword: null,
        roAccessId: null,
        roPassword: null,
        credentialRevision: existing.credentialRevision + 1,
        lastTestAt: null,
        lastTestResult: null,
        updatedAt: new Date(),
      })
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
  try {
    const [row] = await db.select().from(watchguardConnections).where(eq(watchguardConnections.siteId, siteId)).limit(1);
    if (!row) return { ok: false, message: "Belum ada koneksi: simpan dulu (boleh dalam keadaan nonaktif/draft)." };

    const result = await testConnection(siteId);
    const testedCredentialRevision = row.credentialRevision;
    const testedAccountRevision = row.accountRevision;
    const summary = toTestSummary(result);
    const stored = await db
      .update(watchguardConnections)
      .set({
        lastTestAt: new Date(),
        lastTestResult: safeJson({ ...result, credentialRevision: testedCredentialRevision, accountRevision: testedAccountRevision }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(watchguardConnections.id, row.id),
        eq(watchguardConnections.credentialRevision, testedCredentialRevision),
        eq(watchguardConnections.accountRevision, testedAccountRevision),
      ))
      .returning({ id: watchguardConnections.id });

    revalidatePath("/admin/settings");
    if (stored.length === 0) {
      return { ok: false, message: "Pengaturan koneksi berubah selama tes. Jalankan tes kembali." };
    }
    await logAudit({ action: "TEST", entity: "settings", entityName: "WatchGuard Connection", entityId: siteId, detail: "Per-service connection test" });

    return {
      ok: "configured" in result && result.configured ? isAllOk(result) : false,
      message: summary,
      testedCredentialRevision,
      testedAccountRevision,
    };
  } catch {
    return { ok: false, message: "Tes koneksi gagal. Silakan coba lagi." };
  }
}

function isAllOk(result: Awaited<ReturnType<typeof testConnection>>): boolean {
  if (!result.configured || result.unresolved?.read) return false;
  const all = (checks?: ServiceChecks) => checks && Object.values(checks).every((s) => s.ok && !s.skipped);
  if (!all(result.read)) return false;
  // A read-only setup is valid: missing RW credentials are not a failed probe.
  if (result.unresolved?.write === "missing_write_credentials") return true;
  if (result.unresolved?.write) return false;
  return Boolean(!result.write || all(result.write));
}

function toTestSummary(result: Awaited<ReturnType<typeof testConnection>>): string {
  // Never include provider messages or arbitrary exception text in the summary.
  const safeReason = (reason: string) => [
    "not_configured", "disabled", "missing_write_credentials", "unknown_region", "partial_read_credentials",
  ].includes(reason) ? reason : "unresolved";
  const parts: string[] = [];
  if (!result.configured) {
    parts.push(`Tidak dapat mengetes: koneksi belum layak (${safeReason(result.reason)}).`);
  }
  for (const mode of ["read", "write"] as const) {
    const label = mode === "read" ? "RO" : "RW";
    const source = result.credentialSources?.[mode];
    if (source === "ro" || source === "rw") parts.push(`${label}:source=${source.toUpperCase()}`);
    const unresolved = result.unresolved?.[mode];
    if (unresolved) parts.push(`${label}:unresolved=${safeReason(unresolved)}`);
    const checks = result.configured ? result[mode] : undefined;
    if (!checks) continue;
    for (const svc of ["auth", "account", "endpointSecurity", "threatSync"] as const) {
      const s = checks[svc];
      if (!s) continue;
      const details: string[] = [];
      if (s.stage === "oauth" || s.stage === "rest" || s.stage === "resolve") details.push(`stage=${s.stage}`);
      if (typeof s.status === "number" && Number.isInteger(s.status) && s.status >= 100 && s.status <= 599) details.push(`HTTP ${s.status}`);
      if (s.kind && ["auth", "forbidden", "not_found", "rate_limited", "server", "network", "timeout", "invalid_response", "read_only_blocked", "unresolved"].includes(s.kind)) {
        details.push(`kind=${s.kind}`);
      }
      parts.push(`${label}:${svc}=${s.skipped ? "SKIPPED" : s.ok ? "OK" : "gagal"}${details.length ? `(${details.join(", ")})` : ""}`);
    }
  }
  return parts.join(" · ") || "Tidak ada hasil tes layanan.";
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