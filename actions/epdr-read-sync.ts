"use server";

import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { cancelReadSync, emptyReadSyncStatus, enqueueReadSync, readSyncStatus,
  type ReadSyncRequestResult, type ReadSyncStatus } from "@/lib/epdr/read-sync-queue";

export async function requestEpdrReadSync(): Promise<ReadSyncRequestResult> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { status: "unavailable", reason: "forbidden" };
  try {
    const result = await enqueueReadSync(guard.activeSiteId, guard.session.userId);
    if (result.status === "queued" || result.status === "already_pending") {
      await logAudit({ action: result.status === "queued" ? "CREATE" : "TEST", entity: "settings",
        entityId: guard.activeSiteId, entityName: "epdr_read_sync",
        detail: `siteId=${guard.activeSiteId};requestId=${result.requestId};outcome=${result.status}` });
    }
    return result;
  }
  catch { return { status: "unavailable", reason: "internal_error" }; }
}

export async function getEpdrReadSyncStatus(): Promise<ReadSyncStatus> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return emptyReadSyncStatus("unavailable");
  try { return await readSyncStatus(guard.activeSiteId); }
  catch { return emptyReadSyncStatus("unavailable"); }
}

export async function cancelEpdrReadSync(): Promise<{ status: "cancelled" | "unavailable" }> {
  const guard = await requireActiveSiteAdminAction();
  if (!guard.ok) return { status: "unavailable" };
  try {
    await cancelReadSync(guard.activeSiteId);
    await logAudit({ action: "UPDATE", entity: "settings", entityId: guard.activeSiteId,
      entityName: "epdr_read_sync", detail: `siteId=${guard.activeSiteId};operation=cancel_pending` });
    return { status: "cancelled" };
  }
  catch { return { status: "unavailable" }; }
}
