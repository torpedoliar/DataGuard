"use server";

import { revalidatePath } from "next/cache";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { syncNetworkDocs, type NetworkDocSyncSummary } from "@/lib/network-doc";
import { logAudit } from "@/lib/audit";

/**
 * Manual "sync now" for the current active site. Returns the summary on
 * success, or `{ message }` on failure — never throws, so a connection or
 * parse error shows the real message instead of a 500/digest wrapper.
 */
export async function syncNetworkDocsAction(): Promise<NetworkDocSyncSummary | { message: string }> {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    try {
        const summary = await syncNetworkDocs(auth.activeSiteId);

        await logAudit({
            action: "UPDATE",
            entity: "network_port",
            entityName: "Network Doc Sync",
            entityId: auth.activeSiteId,
            detail: JSON.stringify(summary),
        });
        revalidatePath("/admin/network-docs");

        return summary;
    } catch (error) {
        return { message: error instanceof Error ? error.message : String(error) };
    }
}
