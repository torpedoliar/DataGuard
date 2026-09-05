"use server";

import { db } from "@/db";
import { siemFindings, siemResponseActions, users } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ACTION_TYPES = ["block_ip", "disable_port", "isolate_host", "custom"] as const;

export type SiemResponseActionRow = {
  id: number;
  findingId: number;
  actionType: string;
  webhookUrl: string;
  payload: Record<string, unknown>;
  status: string;
  responseStatus: number | null;
  error: string | null;
  requestedByName: string | null;
  approvedByName: string | null;
  createdAt: Date | null;
  executedAt: Date | null;
};

const requestSchema = z.object({
  findingId: z.coerce.number().int().min(1),
  actionType: z.enum(ACTION_TYPES),
  webhookUrl: z.string().url("URL webhook harus valid.").max(2000),
  payload: z.string().refine(
    (value) => {
      if (!value.trim()) return true;
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Payload must be valid JSON." },
  ).optional(),
});

const actionIdSchema = z.object({ id: z.coerce.number().int().min(1) });

async function loadSiteAction(actionId: number, siteId: number) {
  const rows = await db
    .select({ action: siemResponseActions })
    .from(siemResponseActions)
    .innerJoin(siemFindings, eq(siemResponseActions.findingId, siemFindings.id))
    .where(and(eq(siemResponseActions.id, actionId), eq(siemFindings.siteId, siteId)))
    .limit(1);
  return rows[0]?.action ?? null;
}

export async function requestSiemResponseAction(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = requestSchema.safeParse({
    findingId: formData.get("findingId"),
    actionType: formData.get("actionType"),
    webhookUrl: formData.get("webhookUrl"),
    payload: formData.get("payload") ?? "",
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const finding = await db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, parsed.data.findingId), eq(siemFindings.siteId, auth.activeSiteId)),
  });
  if (!finding) return { message: "SIEM finding not found." };

  let payloadValue: Record<string, unknown> = {};
  const trimmed = parsed.data.payload?.trim();
  if (trimmed) {
    const parsedPayload = JSON.parse(trimmed);
    if (parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)) {
      payloadValue = parsedPayload as Record<string, unknown>;
    }
  }

  await db.insert(siemResponseActions).values({
    findingId: finding.id,
    requestedById: auth.session.userId,
    actionType: parsed.data.actionType,
    webhookUrl: parsed.data.webhookUrl.trim(),
    payload: payloadValue,
    status: "pending_approval",
  });

  await logAudit({
    action: "CREATE",
    entity: "siem_finding",
    entityId: finding.id,
    entityName: finding.title,
    detail: `response action requested: ${parsed.data.actionType} -> ${parsed.data.webhookUrl}`,
  });
  revalidatePath("/admin/siem/findings");
  return { success: true };
}

export async function approveSiemResponseAction(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = actionIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const action = await loadSiteAction(parsed.data.id, auth.activeSiteId);
  if (!action) return { message: "Response action not found." };
  if (action.status !== "pending_approval") return { message: "Action is not pending approval." };
  // Two-person rule: approver must differ from requester.
  if (action.requestedById === auth.session.userId) {
    return { message: "Approval harus dari admin lain (two-person rule)." };
  }

  await db.update(siemResponseActions).set({
    status: "approved",
    approvedById: auth.session.userId,
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(siemResponseActions.id, action.id));

  await logAudit({
    action: "UPDATE",
    entity: "siem_response_action",
    entityId: action.id,
    entityName: action.actionType,
    detail: `approved by user #${auth.session.userId}`,
  });
  revalidatePath("/admin/siem/findings");
  return { success: true };
}

export async function cancelSiemResponseAction(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = actionIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const action = await loadSiteAction(parsed.data.id, auth.activeSiteId);
  if (!action) return { message: "Response action not found." };
  if (action.status === "executed") return { message: "Executed actions cannot be cancelled." };
  if (action.status === "executing") return { message: "Action is being executed right now." };
  // Cancel of an approved-but-not-yet-claimed row races the worker's claim;
  // the worker's atomic status check makes whichever write lands first win.

  await db.update(siemResponseActions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(siemResponseActions.id, action.id));
  await logAudit({ action: "UPDATE", entity: "siem_response_action", entityId: action.id, entityName: action.actionType, detail: `cancelled (${action.status})` });
  revalidatePath("/admin/siem/findings");
  return { success: true };
}

export async function listSiemResponseActions(findingId: number): Promise<SiemResponseActionRow[]> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];

  const finding = await db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)),
  });
  if (!finding) return [];

  const requester = users;
  const approver = alias(users, "approver");
  const rows = await db
    .select({
      id: siemResponseActions.id,
      findingId: siemResponseActions.findingId,
      actionType: siemResponseActions.actionType,
      webhookUrl: siemResponseActions.webhookUrl,
      payload: siemResponseActions.payload,
      status: siemResponseActions.status,
      responseStatus: siemResponseActions.responseStatus,
      error: siemResponseActions.error,
      requestedByName: requester.username,
      approvedByName: approver.username,
      createdAt: siemResponseActions.createdAt,
      executedAt: siemResponseActions.executedAt,
    })
    .from(siemResponseActions)
    .leftJoin(requester, eq(siemResponseActions.requestedById, requester.id))
    .leftJoin(approver, eq(siemResponseActions.approvedById, approver.id))
    .where(eq(siemResponseActions.findingId, finding.id))
    .orderBy(desc(siemResponseActions.createdAt))
    .limit(50);

  return rows;
}
