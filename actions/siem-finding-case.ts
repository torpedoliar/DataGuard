"use server";

import { db } from "@/db";
import { siemFindingComments, siemFindings, users } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const findingIdSchema = z.object({ id: z.coerce.number().int().min(1) });

async function loadFinding(findingId: number, siteId: number) {
  return db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, siteId)),
  });
}

export async function assignSiemFinding(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  // Unassign when assigneeId is empty.
  const assigneeRaw = formData.get("assigneeId");
  const parsed = findingIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const finding = await loadFinding(parsed.data.id, auth.activeSiteId);
  if (!finding) return { message: "SIEM finding not found." };

  if (!assigneeRaw) {
    await db.update(siemFindings).set({ assignedToId: null, assignedAt: null, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
    await logAudit({ action: "UPDATE", entity: "siem_finding", entityId: finding.id, entityName: finding.title, detail: "assignee cleared" });
    revalidatePath("/admin/siem/findings");
    return { success: true };
  }

  const assigneeId = z.coerce.number().int().min(1).safeParse(assigneeRaw);
  if (!assigneeId.success) return { message: "Invalid assignee." };

  const [assignee] = await db.select({ id: users.id }).from(users).where(eq(users.id, assigneeId.data)).limit(1);
  if (!assignee) return { message: "Assignee user not found." };

  await db.update(siemFindings).set({ assignedToId: assigneeId.data, assignedAt: new Date(), updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));
  await logAudit({ action: "UPDATE", entity: "siem_finding", entityId: finding.id, entityName: finding.title, detail: `assigned to user #${assigneeId.data}` });
  revalidatePath("/admin/siem/findings");
  return { success: true };
}

const commentSchema = z.object({
  id: z.coerce.number().int().min(1),
  body: z.string().min(1, "Komentar tidak boleh kosong.").max(5000),
});

export async function addSiemFindingComment(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = commentSchema.safeParse({ id: formData.get("id"), body: formData.get("body") });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const finding = await loadFinding(parsed.data.id, auth.activeSiteId);
  if (!finding) return { message: "SIEM finding not found." };

  await db.insert(siemFindingComments).values({
    findingId: finding.id,
    authorId: auth.session.userId,
    body: parsed.data.body.trim(),
  });

  await logAudit({ action: "CREATE", entity: "siem_finding", entityId: finding.id, entityName: finding.title, detail: "comment added" });
  revalidatePath("/admin/siem/findings");
  return { success: true };
}

export type SiemFindingCommentRow = {
  id: number;
  body: string;
  createdAt: Date | null;
  authorName: string | null;
};

export async function getSiemFindingComments(findingId: number): Promise<SiemFindingCommentRow[]> {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return [];

  const finding = await loadFinding(findingId, auth.activeSiteId);
  if (!finding) return [];

  const comments = await db
    .select({
      id: siemFindingComments.id,
      body: siemFindingComments.body,
      createdAt: siemFindingComments.createdAt,
      authorName: users.username,
    })
    .from(siemFindingComments)
    .leftJoin(users, eq(siemFindingComments.authorId, users.id))
    .where(eq(siemFindingComments.findingId, finding.id))
    .orderBy(asc(siemFindingComments.createdAt));

  return comments;
}
