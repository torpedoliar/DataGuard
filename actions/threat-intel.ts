"use server";

import { db } from "@/db";
import {
  devices,
  sites,
  threatIntelligenceEvidences,
  threatIntelligences,
  users,
} from "@/db/schema";
import { logAuditManual } from "@/lib/audit";
import { verifySession } from "@/lib/session";
import {
  calculateCvssSeverity,
  threatIntelSchema,
  type ThreatIntelRecord,
  type ThreatIntelStats,
  type ThreatSeverity,
  type ThreatStatus,
} from "@/lib/threat-intel";
import { saveUploadFile } from "@/lib/upload";
import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireComplianceAdmin() {
  const session = await verifySession();
  if (!session || (session.role !== "admin" && session.role !== "superadmin")) {
    return { ok: false as const, message: "Unauthorized. Admin access required." };
  }
  return { ok: true as const, session };
}

export type ThreatIntelFilters = {
  siteId?: number | null | "all";
  status?: ThreatStatus | "all";
  severity?: ThreatSeverity | "all";
  search?: string;
  year?: number;
};

export async function getThreatIntelligences(filters: ThreatIntelFilters = {}) {
  const auth = await requireComplianceAdmin();
  if (!auth.ok) {
    return { success: false, message: auth.message, items: [], stats: emptyStats() };
  }

  const conditions: SQL[] = [];

  // Site filter: if specific siteId, match that site OR global (siteId is null)
  if (filters.siteId !== undefined && filters.siteId !== "all") {
    if (filters.siteId === null) {
      conditions.push(isNull(threatIntelligences.siteId));
    } else {
      conditions.push(or(eq(threatIntelligences.siteId, filters.siteId), isNull(threatIntelligences.siteId))!);
    }
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(threatIntelligences.status, filters.status));
  }

  // Severity filter
  if (filters.severity && filters.severity !== "all") {
    conditions.push(eq(threatIntelligences.severity, filters.severity));
  }

  // Year filter
  if (filters.year) {
    const yearStart = new Date(filters.year, 0, 1);
    const yearEnd = new Date(filters.year + 1, 0, 1);
    conditions.push(and(gte(threatIntelligences.intelDate, yearStart), lt(threatIntelligences.intelDate, yearEnd))!);
  }

  // Search filter
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(threatIntelligences.title, q),
        ilike(threatIntelligences.cveList, q),
        ilike(threatIntelligences.affectedAsset, q),
        ilike(threatIntelligences.source, q),
        ilike(threatIntelligences.mitigationAction, q)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: threatIntelligences.id,
      siteId: threatIntelligences.siteId,
      siteName: sites.name,
      deviceId: threatIntelligences.deviceId,
      deviceName: devices.name,
      intelDate: threatIntelligences.intelDate,
      source: threatIntelligences.source,
      sourceUrl: threatIntelligences.sourceUrl,
      title: threatIntelligences.title,
      cveList: threatIntelligences.cveList,
      cvssScore: threatIntelligences.cvssScore,
      severity: threatIntelligences.severity,
      description: threatIntelligences.description,
      affectedAsset: threatIntelligences.affectedAsset,
      status: threatIntelligences.status,
      mitigatedAt: threatIntelligences.mitigatedAt,
      mitigationAction: threatIntelligences.mitigationAction,
      createdById: threatIntelligences.createdById,
      createdByName: users.username,
      createdAt: threatIntelligences.createdAt,
      updatedAt: threatIntelligences.updatedAt,
    })
    .from(threatIntelligences)
    .leftJoin(sites, eq(threatIntelligences.siteId, sites.id))
    .leftJoin(devices, eq(threatIntelligences.deviceId, devices.id))
    .leftJoin(users, eq(threatIntelligences.createdById, users.id))
    .where(whereClause)
    .orderBy(desc(threatIntelligences.intelDate), desc(threatIntelligences.id));

  // Batch load evidences for matched advisories
  const advisoryIds = rows.map((r) => r.id);
  const evidencesByAdvisoryId: Record<number, ThreatIntelRecord["evidences"]> = {};

  if (advisoryIds.length > 0) {
    const evidenceRows = await db
      .select()
      .from(threatIntelligenceEvidences)
      .where(inArray(threatIntelligenceEvidences.threatIntelId, advisoryIds))
      .orderBy(threatIntelligenceEvidences.id);

    for (const ev of evidenceRows) {
      if (!evidencesByAdvisoryId[ev.threatIntelId]) {
        evidencesByAdvisoryId[ev.threatIntelId] = [];
      }
      evidencesByAdvisoryId[ev.threatIntelId].push(ev);
    }
  }

  const items: ThreatIntelRecord[] = rows.map((row) => ({
    ...row,
    evidences: evidencesByAdvisoryId[row.id] || [],
  }));

  // Calculate stats
  const total = items.length;
  let open = 0;
  let inProgress = 0;
  let mitigated = 0;
  let notApplicableOrAccepted = 0;
  let criticalHigh = 0;

  for (const item of items) {
    if (item.status === "open") open++;
    else if (item.status === "in_progress") inProgress++;
    else if (item.status === "mitigated") mitigated++;
    else if (item.status === "not_applicable" || item.status === "accepted_risk") notApplicableOrAccepted++;

    if (item.severity === "critical" || item.severity === "high") criticalHigh++;
  }

  const resolvedCount = mitigated + notApplicableOrAccepted;
  const mitigationRate = total > 0 ? Math.round((resolvedCount / total) * 100) : 100;

  const stats: ThreatIntelStats = {
    total,
    open,
    inProgress,
    mitigated,
    notApplicableOrAccepted,
    criticalHigh,
    mitigationRate,
  };

  return { success: true, items, stats };
}

function emptyStats(): ThreatIntelStats {
  return {
    total: 0,
    open: 0,
    inProgress: 0,
    mitigated: 0,
    notApplicableOrAccepted: 0,
    criticalHigh: 0,
    mitigationRate: 100,
  };
}

export async function createThreatIntel(formData: FormData) {
  const auth = await requireComplianceAdmin();
  if (!auth.ok) return { success: false, message: auth.message };

  const rawData = {
    title: formData.get("title"),
    source: formData.get("source"),
    sourceUrl: formData.get("sourceUrl") || undefined,
    intelDate: formData.get("intelDate"),
    cveList: formData.get("cveList") || undefined,
    cvssScore: formData.get("cvssScore") || null,
    severity: formData.get("severity") || undefined,
    description: formData.get("description") || undefined,
    affectedAsset: formData.get("affectedAsset"),
    status: formData.get("status") || "open",
    mitigatedAt: formData.get("mitigatedAt") || null,
    mitigationAction: formData.get("mitigationAction") || undefined,
    siteId: formData.get("siteId") || null,
    deviceId: formData.get("deviceId") || null,
  };

  const parsed = threatIntelSchema.safeParse(rawData);
  if (!parsed.success) {
    const err = parsed.error.issues[0]?.message || "Invalid input data";
    return { success: false, message: err };
  }

  const data = parsed.data;
  const cvssScore = data.cvssScore !== undefined && data.cvssScore !== null ? Number(data.cvssScore) : null;
  const severity = data.severity || calculateCvssSeverity(cvssScore);

  try {
    const [inserted] = await db
      .insert(threatIntelligences)
      .values({
        siteId: data.siteId ? Number(data.siteId) : null,
        deviceId: data.deviceId ? Number(data.deviceId) : null,
        intelDate: new Date(data.intelDate),
        source: data.source,
        sourceUrl: data.sourceUrl || null,
        title: data.title,
        cveList: data.cveList || null,
        cvssScore,
        severity,
        description: data.description || null,
        affectedAsset: data.affectedAsset,
        status: data.status,
        mitigatedAt: data.mitigatedAt ? new Date(data.mitigatedAt) : null,
        mitigationAction: data.mitigationAction || null,
        createdById: auth.session.userId,
      })
      .returning();

    // Process attached evidence files
    const evidenceFiles = formData.getAll("evidences") as File[];
    const captions = formData.getAll("captions") as string[];

    for (let i = 0; i < evidenceFiles.length; i++) {
      const file = evidenceFiles[i];
      if (file && file.size > 0) {
        try {
          const filePath = await saveUploadFile(
            file,
            `threat-intel-${inserted.id}-${i}`,
            { kind: "photo", directory: "threat-intel" }
          );
          if (filePath) {
            await db.insert(threatIntelligenceEvidences).values({
              threatIntelId: inserted.id,
              filePath,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
              caption: captions[i] || null,
            });
          }
        } catch (uploadErr) {
          console.error("Evidence upload error:", uploadErr);
        }
      }
    }

    await logAuditManual({
      userId: auth.session.userId,
      username: auth.session.username,
      siteId: data.siteId ? Number(data.siteId) : auth.session.activeSiteId ?? null,
      action: "CREATE",
      entity: "threat_intel",
      entityId: inserted.id,
      entityName: inserted.title,
      detail: `Created Threat Intelligence advisory: ${inserted.title} (${inserted.affectedAsset})`,
    });

    revalidatePath("/compliance/threat-intel");
    return { success: true, id: inserted.id };
  } catch (err: unknown) {
    console.error("Failed to create threat intel:", err);
    return { success: false, message: "Failed to create threat intelligence record" };
  }
}

export async function updateThreatIntel(id: number, formData: FormData) {
  const auth = await requireComplianceAdmin();
  if (!auth.ok) return { success: false, message: auth.message };

  const rawData = {
    title: formData.get("title"),
    source: formData.get("source"),
    sourceUrl: formData.get("sourceUrl") || undefined,
    intelDate: formData.get("intelDate"),
    cveList: formData.get("cveList") || undefined,
    cvssScore: formData.get("cvssScore") || null,
    severity: formData.get("severity") || undefined,
    description: formData.get("description") || undefined,
    affectedAsset: formData.get("affectedAsset"),
    status: formData.get("status") || "open",
    mitigatedAt: formData.get("mitigatedAt") || null,
    mitigationAction: formData.get("mitigationAction") || undefined,
    siteId: formData.get("siteId") || null,
    deviceId: formData.get("deviceId") || null,
  };

  const parsed = threatIntelSchema.safeParse(rawData);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const data = parsed.data;
  const cvssScore = data.cvssScore !== undefined && data.cvssScore !== null ? Number(data.cvssScore) : null;
  const severity = data.severity || calculateCvssSeverity(cvssScore);

  try {
    const [updated] = await db
      .update(threatIntelligences)
      .set({
        siteId: data.siteId ? Number(data.siteId) : null,
        deviceId: data.deviceId ? Number(data.deviceId) : null,
        intelDate: new Date(data.intelDate),
        source: data.source,
        sourceUrl: data.sourceUrl || null,
        title: data.title,
        cveList: data.cveList || null,
        cvssScore,
        severity,
        description: data.description || null,
        affectedAsset: data.affectedAsset,
        status: data.status,
        mitigatedAt: data.mitigatedAt ? new Date(data.mitigatedAt) : null,
        mitigationAction: data.mitigationAction || null,
        updatedAt: new Date(),
      })
      .where(eq(threatIntelligences.id, id))
      .returning();

    if (!updated) {
      return { success: false, message: "Threat intelligence record not found" };
    }

    // Process removed evidence IDs
    const deletedEvidenceIdsRaw = formData.get("deletedEvidenceIds");
    if (deletedEvidenceIdsRaw && typeof deletedEvidenceIdsRaw === "string") {
      try {
        const deletedIds: number[] = JSON.parse(deletedEvidenceIdsRaw);
        if (Array.isArray(deletedIds) && deletedIds.length > 0) {
          await db
            .delete(threatIntelligenceEvidences)
            .where(
              and(
                eq(threatIntelligenceEvidences.threatIntelId, id),
                inArray(threatIntelligenceEvidences.id, deletedIds)
              )
            );
        }
      } catch (e) {
        console.warn("Invalid deletedEvidenceIds payload", e);
      }
    }

    // Process newly uploaded evidence files
    const evidenceFiles = formData.getAll("evidences") as File[];
    const captions = formData.getAll("captions") as string[];

    for (let i = 0; i < evidenceFiles.length; i++) {
      const file = evidenceFiles[i];
      if (file && file.size > 0) {
        try {
          const filePath = await saveUploadFile(
            file,
            `threat-intel-${id}-${Date.now()}-${i}`,
            { kind: "photo", directory: "threat-intel" }
          );
          if (filePath) {
            await db.insert(threatIntelligenceEvidences).values({
              threatIntelId: id,
              filePath,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
              caption: captions[i] || null,
            });
          }
        } catch (uploadErr) {
          console.error("Evidence upload error:", uploadErr);
        }
      }
    }

    await logAuditManual({
      userId: auth.session.userId,
      username: auth.session.username,
      siteId: updated.siteId ?? auth.session.activeSiteId ?? null,
      action: "UPDATE",
      entity: "threat_intel",
      entityId: updated.id,
      entityName: updated.title,
      detail: `Updated Threat Intelligence advisory: ${updated.title} (Status: ${updated.status})`,
    });

    revalidatePath("/compliance/threat-intel");
    return { success: true, id: updated.id };
  } catch (err) {
    console.error("Failed to update threat intel:", err);
    return { success: false, message: "Failed to update record" };
  }
}

export async function deleteThreatIntel(id: number) {
  const auth = await requireComplianceAdmin();
  if (!auth.ok) return { success: false, message: auth.message };

  try {
    const [existing] = await db
      .select({ id: threatIntelligences.id, title: threatIntelligences.title, siteId: threatIntelligences.siteId })
      .from(threatIntelligences)
      .where(eq(threatIntelligences.id, id));

    if (!existing) {
      return { success: false, message: "Threat intelligence record not found" };
    }

    await db.delete(threatIntelligences).where(eq(threatIntelligences.id, id));

    await logAuditManual({
      userId: auth.session.userId,
      username: auth.session.username,
      siteId: existing.siteId ?? auth.session.activeSiteId ?? null,
      action: "DELETE",
      entity: "threat_intel",
      entityId: existing.id,
      entityName: existing.title,
      detail: `Deleted Threat Intelligence advisory: ${existing.title}`,
    });

    revalidatePath("/compliance/threat-intel");
    return { success: true };
  } catch (err) {
    console.error("Failed to delete threat intel:", err);
    return { success: false, message: "Failed to delete record" };
  }
}
