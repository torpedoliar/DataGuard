"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { watchguardConnections } from "@/db/schema";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { requireSiteAccess } from "@/lib/site-access";
import { overviewCountsQuery } from "@/lib/epdr/overview-query";
import { loadSecurityContext, type EpdrSecurityContext } from "./epdr-endpoints";

export type OverviewCounts = {
  total: number; protected: number; disabled: number; error: number; install_error: number;
  no_license: number; outdated: number; unknown: number; offline: number; unknown_contact: number;
  threats: number; highScore: number; pending: number; review: number;
};
export type OverviewSource = { source: "inventory" | "detections" | "provider"; state: "unavailable" | "unknown" | "stale" | "partial" | "unverified" | "current"; lastSyncAt: Date | null };
export type EpdrOverview = EpdrSecurityContext & { counts: OverviewCounts | null; sources: OverviewSource[]; available: boolean };

/** Local read models only. Counts aggregate the full current account, never a map/table sample. */
export async function getEpdrOverview(): Promise<EpdrOverview | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  const siteId = guard.activeSiteId;
  if (!await requireSiteAccess(siteId)) return { message: "Unauthorized." };
  const context = await loadSecurityContext(siteId, guard.session.role);
  const [binding] = await db.select({
    id: watchguardConnections.id, accountId: watchguardConnections.accountId,
    accountRevision: watchguardConnections.accountRevision, enabled: watchguardConnections.enabled,
    inventory: watchguardConnections.lastEndpointSyncAt, detections: watchguardConnections.lastDetectionSyncAt,
    provider: watchguardConnections.lastProviderSyncAt, error: watchguardConnections.lastSyncError,
    providerError: watchguardConnections.lastProviderSyncError,
    inventoryMinutes: watchguardConnections.endpointSyncMinutes, detectionMinutes: watchguardConnections.detectionSyncMinutes,
  }).from(watchguardConnections).where(eq(watchguardConnections.siteId, siteId)).limit(1);
  const usable = Boolean(binding?.enabled && binding.accountId?.trim());
  const sources: OverviewSource[] = (["inventory", "detections", "provider"] as const).map((source) => {
    const lastSyncAt = binding?.[source] ?? null;
    const error = source === "provider" ? binding?.providerError : binding?.error;
    const minutes = source === "inventory" ? binding?.inventoryMinutes : binding?.detectionMinutes;
    return { source, lastSyncAt, state: !usable ? "unavailable" : error ? "partial" : !lastSyncAt ? "unknown"
      : Date.now() - new Date(lastSyncAt).getTime() > Math.max((minutes ?? 5) * 3, 15) * 60000 ? "stale"
      // Inventory/detection jobs share one mutable error field. A sibling job
      // can clear it, so a recent legacy timestamp cannot prove source health.
      : source === "provider" ? "current" : "unverified" };
  });
  if (!usable || !binding) return { ...context, counts: null, sources, available: false };
  const now = new Date();
  try {
    const { rows } = await db.execute<OverviewCounts>(overviewCountsQuery(siteId, binding, now));
    const counts = rows[0];
    return { ...context, counts: counts ?? null, sources, available: Boolean(counts) };
  } catch {
    // A failed local read is unavailable, never an all-zero healthy dashboard.
    return { ...context, counts: null, sources, available: false };
  }
}
