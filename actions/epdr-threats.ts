"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { epdrDetections } from "@/db/schema";
import { requireActiveSiteAction } from "@/lib/action-auth";

export type EpdrDetectionRow = {
  id: number;
  source: string;
  category: string;
  providerType: string | null;
  threatName: string | null;
  threatScore: number | null;
  severity: string;
  detectedAt: Date;
  endpointId: number | null;
  incidentId: number | null;
  ignoredReason: string | null;
};

export type EpdrDetectionsData = {
  detections: EpdrDetectionRow[];
  partial: boolean;
};

export async function getEpdrDetections(): Promise<EpdrDetectionsData | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };

  const rows = await db
    .select({
      id: epdrDetections.id,
      source: epdrDetections.source,
      category: epdrDetections.category,
      providerType: epdrDetections.providerType,
      threatName: epdrDetections.threatName,
      threatScore: epdrDetections.threatScore,
      severity: epdrDetections.severity,
      detectedAt: epdrDetections.detectedAt,
      endpointId: epdrDetections.endpointId,
      incidentId: epdrDetections.incidentId,
      ignoredReason: epdrDetections.ignoredReason,
    })
    .from(epdrDetections)
    .where(and(eq(epdrDetections.siteId, guard.activeSiteId), isNull(epdrDetections.ignoredReason)))
    .orderBy(desc(epdrDetections.detectedAt))
    .limit(200);

  return { detections: rows, partial: false };
}