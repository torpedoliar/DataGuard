"use server";

import { db } from "@/db";
import { devices, incidentUpdates, incidents, siemFindings, siemRules, sites, syslogSources } from "@/db/schema";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { calculateIncidentDueDate } from "@/lib/incidents";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const findingStatusSchema = z.object({
  id: z.coerce.number().min(1),
  status: z.enum(["Open", "Acknowledged", "Resolved"]),
});

export type SiemFindingListFilters = {
  status?: "Open" | "Acknowledged" | "Resolved";
  severity?: "Low" | "Medium" | "High" | "Critical";
};

export async function getSiemFindings(filters: SiemFindingListFilters = {}) {
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { findings: [], message: auth.message };

  const conditions = [eq(siemFindings.siteId, auth.activeSiteId)];
  if (filters.status) conditions.push(eq(siemFindings.status, filters.status));
  if (filters.severity) conditions.push(eq(siemFindings.severity, filters.severity));

  const findings = await db.select({
    id: siemFindings.id,
    title: siemFindings.title,
    summary: siemFindings.summary,
    humanAnalysis: siemFindings.humanAnalysis,
    recommendedAction: siemFindings.recommendedAction,
    aiAnalysis: siemFindings.aiAnalysis,
    aiGeneratedAt: siemFindings.aiGeneratedAt,
    severity: siemFindings.severity,
    status: siemFindings.status,
    eventCount: siemFindings.eventCount,
    firstSeenAt: siemFindings.firstSeenAt,
    lastSeenAt: siemFindings.lastSeenAt,
    sampleEventIds: siemFindings.sampleEventIds,
    correlationKey: siemFindings.correlationKey,
    createdIncidentId: siemFindings.createdIncidentId,
    ruleKey: siemRules.key,
    ruleName: siemRules.name,
    ruleCategory: siemRules.category,
    siteName: sites.name,
    deviceId: siemFindings.deviceId,
    deviceName: devices.name,
    sourceName: syslogSources.displayName,
    sourceIp: syslogSources.sourceIp,
  })
    .from(siemFindings)
    .leftJoin(siemRules, eq(siemFindings.ruleId, siemRules.id))
    .leftJoin(sites, eq(siemFindings.siteId, sites.id))
    .leftJoin(devices, eq(siemFindings.deviceId, devices.id))
    .leftJoin(syslogSources, eq(siemFindings.sourceId, syslogSources.id))
    .where(and(...conditions))
    .orderBy(desc(siemFindings.lastSeenAt))
    .limit(200);

  return { findings };
}

export async function createIncidentFromSiemFinding(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const findingId = Number(formData.get("id"));
  if (!findingId) return { message: "Invalid SIEM finding." };

  const finding = await db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, findingId), eq(siemFindings.siteId, auth.activeSiteId)),
  });
  if (!finding) return { message: "SIEM finding not found." };
  if (finding.createdIncidentId) return { message: "Incident already exists for this finding." };
  if (!finding.deviceId) return { message: "Map the syslog source to a device before creating an incident." };

  const [incident] = await db.insert(incidents).values({
    siteId: auth.activeSiteId,
    deviceId: finding.deviceId,
    title: finding.title,
    description: [finding.humanAnalysis ?? finding.summary, finding.recommendedAction ? `Recommended action: ${finding.recommendedAction}` : null].filter(Boolean).join("\n\n"),
    severity: finding.severity,
    status: "Open",
    createdById: auth.session.userId,
    dueDate: calculateIncidentDueDate(finding.severity),
  }).returning();

  await db.insert(incidentUpdates).values({
    incidentId: incident.id,
    authorId: auth.session.userId,
    updateType: "created",
    note: `Created from SIEM finding #${finding.id}`,
    newStatus: "Open",
  });

  await db.update(siemFindings).set({ createdIncidentId: incident.id, updatedAt: new Date() }).where(eq(siemFindings.id, finding.id));

  await logAudit({ action: "CREATE", entity: "incident", entityId: incident.id, entityName: incident.title, detail: `SIEM finding #${finding.id}` });
  revalidatePath("/admin/siem/findings");
  revalidatePath("/admin/incidents");
  return { success: true, incidentId: incident.id };
}

export async function updateSiemFindingStatus(prevState: unknown, formData: FormData) {
  void prevState;
  const auth = await requireActiveSiteAdminAction();
  if (!auth.ok) return { message: auth.message };

  const parsed = findingStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const existing = await db.query.siemFindings.findFirst({
    where: and(eq(siemFindings.id, parsed.data.id), eq(siemFindings.siteId, auth.activeSiteId)),
  });
  if (!existing) return { message: "SIEM finding not found." };

  await db.update(siemFindings).set({
    status: parsed.data.status,
    acknowledgedBy: parsed.data.status === "Acknowledged" ? auth.session.userId : existing.acknowledgedBy,
    acknowledgedAt: parsed.data.status === "Acknowledged" ? new Date() : existing.acknowledgedAt,
    resolvedBy: parsed.data.status === "Resolved" ? auth.session.userId : existing.resolvedBy,
    resolvedAt: parsed.data.status === "Resolved" ? new Date() : existing.resolvedAt,
    updatedAt: new Date(),
  }).where(eq(siemFindings.id, parsed.data.id));

  await logAudit({ action: "UPDATE", entity: "siem_finding", entityId: parsed.data.id, entityName: existing.title, detail: `SIEM finding status: ${parsed.data.status}` });
  revalidatePath("/admin/siem/findings");
  return { success: true };
}
