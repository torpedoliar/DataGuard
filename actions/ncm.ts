"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import * as ncmLib from "@/lib/ncm";
import { logAudit } from "@/lib/audit";

// ==================== Write side ====================

// Password switch is pass-through only: it is forwarded to NCM once and never
// stored, logged, audited, or echoed back by these actions.
export type NcmWriteResult = { success: true; message: string } | { success?: false; message: string; errors?: unknown };

async function runNcmWrite(
  action: "CREATE" | "UPDATE" | "DELETE" | "BACKUP",
  entity: "ncm_switch" | "ncm_schedule" | "ncm_backup" | "ncm_baseline" | "ncm_review",
  entityName: string,
  entityId: number | undefined,
  detail: string,
  run: (config: { url: string; adminApiKey: string }) => Promise<unknown>,
): Promise<NcmWriteResult> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const config = await ncmLib.resolveNcmConfig(auth.activeSiteId);
  if (!config.url || !config.adminApiKey) {
    return { message: "NCM belum dikonfigurasi untuk site ini. Hubungi superadmin." };
  }

  try {
    await run({ url: config.url, adminApiKey: config.adminApiKey });
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  await logAudit({ action, entity, entityId, entityName, detail });
  revalidatePath("/admin/ncm");
  return { success: true, message: `${entityName}: OK` };
}

const idString = z
  .string()
  .refine((value) => Number.isInteger(Number(value)) && Number(value) > 0, {
    message: "ID tidak valid.",
  });

const switchSchema = z.object({
  name: z.string().trim().min(1, "Nama switch wajib diisi.").max(120),
  ip: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{1,3}(\.\d{1,3}){3}$/.test(value), {
      message: "IP harus berupa IPv4 yang valid.",
    })
    .transform((value) => value || undefined),
  protocol: z.enum(["ssh", "telnet", "snmp"]).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

export async function addNcmSwitch(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const parsed = switchSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    ip: String(formData.get("ip") ?? ""),
    protocol: formData.get("protocol") ? String(formData.get("protocol")) : undefined,
    port: formData.get("port") ? String(formData.get("port")) : undefined,
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  return runNcmWrite("CREATE", "ncm_switch", parsed.data.name, undefined, "Switch ditambahkan via /admin/ncm", (config) =>
    ncmLib.createNcmSwitch(config, parsed.data),
  );
}

export async function updateNcmSwitch(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const idParsed = idString.safeParse(String(formData.get("id") ?? ""));
  if (!idParsed.success) return { message: "ID switch tidak valid." };
  const parsed = switchSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    ip: String(formData.get("ip") ?? ""),
    protocol: formData.get("protocol") ? String(formData.get("protocol")) : undefined,
    port: formData.get("port") ? String(formData.get("port")) : undefined,
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const switchId = Number(idParsed.data);
  return runNcmWrite("UPDATE", "ncm_switch", parsed.data.name, switchId, "Switch diperbarui via /admin/ncm", (config) =>
    ncmLib.updateNcmSwitch(config, switchId, parsed.data),
  );
}

export async function deleteNcmSwitch(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const idParsed = idString.safeParse(String(formData.get("id") ?? ""));
  if (!idParsed.success) return { message: "ID switch tidak valid." };
  const switchId = Number(idParsed.data);
  return runNcmWrite("DELETE", "ncm_switch", `Switch #${switchId}`, switchId, "Switch dihapus via /admin/ncm", (config) =>
    ncmLib.deleteNcmSwitch(config, switchId),
  );
}

const credentialsSchema = z.object({
  switchId: idString,
  username: z.string().trim().min(1, "Username wajib diisi.").max(120),
  password: z.string().min(1, "Password wajib diisi.").max(200),
});

export async function rotateNcmCredentials(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const parsed = credentialsSchema.safeParse({
    switchId: String(formData.get("switchId") ?? ""),
    username: String(formData.get("username") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const switchId = Number(parsed.data.switchId);
  // detail intentionally value-free: the password never reaches the audit log.
  return runNcmWrite(
    "UPDATE",
    "ncm_switch",
    `Switch #${switchId}`,
    switchId,
    "Kredensial switch diperbarui (nilai kredensial tidak dicatat)",
    (config) => ncmLib.updateNcmCredentials(config, switchId, { username: parsed.data.username, password: parsed.data.password }),
  );
}

const scheduleSchema = z.object({
  jobId: idString,
  schedule: z.string().trim().min(1, "Jadwal (cron) wajib diisi.").max(100),
  enabled: z
    .string()
    .optional()
    .transform((value) => value === "on" || value === "true" || value === "1"),
});

const reviewDecisionSchema = z.object({
  reviewId: idString,
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export async function updateNcmSchedule(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const parsed = scheduleSchema.safeParse({
    jobId: String(formData.get("jobId") ?? ""),
    schedule: String(formData.get("schedule") ?? ""),
    enabled: formData.get("enabled") ? String(formData.get("enabled")) : undefined,
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const jobId = Number(parsed.data.jobId);
  return runNcmWrite("UPDATE", "ncm_schedule", `Job #${jobId}`, jobId, `Jadwal diubah (${parsed.data.schedule})`, (config) =>
    ncmLib.updateNcmJob(config, jobId, { schedule: parsed.data.schedule, enabled: parsed.data.enabled }),
  );
}

export async function triggerNcmBackup(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const idParsed = idString.safeParse(String(formData.get("switchId") ?? ""));
  if (!idParsed.success) return { message: "ID switch tidak valid." };
  const switchId = Number(idParsed.data);
  return runNcmWrite("BACKUP", "ncm_backup", `Switch #${switchId}`, switchId, "Backup on-demand dipicu", (config) =>
    ncmLib.triggerNcmBackup(config, switchId),
  );
}

export async function createNcmBaseline(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const idParsed = idString.safeParse(String(formData.get("backupId") ?? ""));
  if (!idParsed.success) return { message: "ID backup tidak valid." };
  const backupId = Number(idParsed.data);
  return runNcmWrite("CREATE", "ncm_baseline", `Backup #${backupId}`, backupId, "Baseline golden dibuat dari backup", (config) =>
    ncmLib.createNcmBaseline(config, { backup_id: backupId }),
  );
}

export async function decideNcmReview(_prev: unknown, formData: FormData): Promise<NcmWriteResult> {
  void _prev;
  const parsed = reviewDecisionSchema.safeParse({
    reviewId: String(formData.get("reviewId") ?? ""),
    decision: String(formData.get("decision") ?? ""),
    note: formData.get("note") ? String(formData.get("note")) : undefined,
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const reviewId = Number(parsed.data.reviewId);
  return runNcmWrite(
    "UPDATE",
    "ncm_review",
    `Review #${reviewId}`,
    reviewId,
    `Review ${parsed.data.decision === "approve" ? "disetujui" : "ditolak"}${parsed.data.note ? ` (catatan: ${parsed.data.note})` : ""}`,
    (config) => ncmLib.decideNcmReview(config, reviewId, { decision: parsed.data.decision, note: parsed.data.note }),
  );
}


// ==================== Read side ====================

export type NcmOverview =
  | { status: "unconfigured"; message: string }
  | { status: "online"; url: string | null; switches: unknown; jobs: unknown; backups: unknown; baselines: unknown; reviews: unknown }
  | { status: "offline"; url: string | null; lastSeenAt: string | null; error: string };

/** Snapshot fleet live dari NCM (transient — tidak disinkron ke DB). */
export async function getNcmOverview(): Promise<NcmOverview> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { status: "unconfigured", message: auth.message };

  const config = await ncmLib.resolveNcmConfig(auth.activeSiteId);
  if (!config.url || !config.adminApiKey) {
    return { status: "unconfigured", message: "NCM belum dikonfigurasi untuk site ini. Hubungi superadmin." };
  }

  const connection = { url: config.url, adminApiKey: config.adminApiKey };
  try {
    const [switches, jobs, backups, baselines, reviews] = await Promise.all([
      ncmLib.fetchNcmSwitches(connection),
      ncmLib.fetchNcmJobs(connection),
      ncmLib.fetchNcmBackups(connection),
      ncmLib.fetchNcmBaselines(connection),
      ncmLib.fetchNcmReviews(connection),
    ]);
    await ncmLib.touchNcmLastSeen(auth.activeSiteId);
    return { status: "online", url: config.url, switches, jobs, backups, baselines, reviews };
  } catch (error) {
    const lastSeen = await ncmLib.getNcmLastSeen(auth.activeSiteId);
    return {
      status: "offline",
      url: config.url,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Detail satu review (diff) untuk tampilan UI. */
export async function getNcmReviewDetail(reviewId: number): Promise<Record<string, unknown>> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const config = await ncmLib.resolveNcmConfig(auth.activeSiteId);
  if (!config.url || !config.adminApiKey) {
    return { message: "NCM belum dikonfigurasi untuk site ini. Hubungi superadmin." };
  }

  try {
    return (await ncmLib.fetchNcmReview({ url: config.url, adminApiKey: config.adminApiKey }, reviewId)) as Record<string, unknown>;
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}
