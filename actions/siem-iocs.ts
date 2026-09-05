"use server";

import { db } from "@/db";
import { siemIocs } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { siemSeverities } from "@/lib/siem/types";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const IOC_TYPES = ["ip", "domain", "hash"] as const;
type IocType = (typeof IOC_TYPES)[number];

export type SiemIocRow = {
  id: number;
  type: IocType;
  value: string;
  description: string | null;
  severity: (typeof siemSeverities)[number];
  enabled: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

const iocSchema = z.object({
  type: z.enum(IOC_TYPES),
  value: z.string().min(1, "Value wajib diisi.").max(500)
    .transform((value) => value.trim()),
  description: z.string().max(1000).optional(),
  severity: z.enum(siemSeverities).default("High"),
  expiresAt: z
    .union([z.coerce.number().int().min(1).max(3650), z.literal("")])
    .transform((value) => (value === "" ? null : value))
    .optional(),
});

function normalizeValue(type: IocType, value: string): string {
  // ip matches exactly; domain/hash are case-insensitive, so store lowercase.
  return type === "ip" ? value : value.toLowerCase();
}

export async function getSiemIocs() {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { iocs: [], message: auth.message };

  const iocs = await db
    .select({
      id: siemIocs.id,
      type: siemIocs.type,
      value: siemIocs.value,
      description: siemIocs.description,
      severity: siemIocs.severity,
      enabled: siemIocs.enabled,
      expiresAt: siemIocs.expiresAt,
      createdAt: siemIocs.createdAt,
    })
    .from(siemIocs)
    .where(eq(siemIocs.siteId, auth.activeSiteId))
    .orderBy(desc(siemIocs.createdAt))
    .limit(500);

  return { iocs: iocs as SiemIocRow[] };
}

export async function createSiemIoc(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = iocSchema.safeParse({
    type: formData.get("type"),
    value: formData.get("value"),
    description: formData.get("description") ?? "",
    severity: formData.get("severity") ?? "High",
    expiresAt: formData.get("expiresDays") ?? "",
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const value = normalizeValue(parsed.data.type, parsed.data.value);
  if (!value) return { message: "Value wajib diisi." };

  const expiresAt = parsed.data.expiresAt
    ? new Date(Date.now() + parsed.data.expiresAt * 24 * 60 * 60 * 1000)
    : null;

  try {
    await db.insert(siemIocs).values({
      siteId: auth.activeSiteId,
      type: parsed.data.type,
      value,
      description: parsed.data.description?.trim() || null,
      severity: parsed.data.severity,
      expiresAt,
      createdById: auth.session.userId,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return { message: "IOC dengan type dan value ini sudah ada." };
    }
    throw error;
  }

  await logAudit({
    action: "CREATE",
    entity: "settings",
    entityName: "SIEM IOC",
    detail: `type=${parsed.data.type}, value=${value}, severity=${parsed.data.severity}`,
  });
  revalidatePath("/admin/siem/iocs");
  return { success: true };
}

const iocToggleSchema = z.object({ id: z.coerce.number().int().min(1) });

export async function toggleSiemIoc(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = iocToggleSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const existing = await db.query.siemIocs.findFirst({
    where: and(eq(siemIocs.id, parsed.data.id), eq(siemIocs.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "IOC not found." };

  await db.update(siemIocs).set({ enabled: !existing.enabled, updatedAt: new Date() }).where(eq(siemIocs.id, existing.id));
  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM IOC", entityId: existing.id, detail: `enabled=${!existing.enabled}, value=${existing.value}` });
  revalidatePath("/admin/siem/iocs");
  return { success: true };
}

export async function deleteSiemIoc(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = iocToggleSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const existing = await db.query.siemIocs.findFirst({
    where: and(eq(siemIocs.id, parsed.data.id), eq(siemIocs.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "IOC not found." };

  await db.delete(siemIocs).where(eq(siemIocs.id, existing.id));
  await logAudit({ action: "DELETE", entity: "settings", entityName: "SIEM IOC", entityId: existing.id, detail: `type=${existing.type}, value=${existing.value}` });
  revalidatePath("/admin/siem/iocs");
  return { success: true };
}
