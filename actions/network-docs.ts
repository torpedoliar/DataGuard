"use server";

import { revalidatePath } from "next/cache";
import { requireActiveSiteAdminAction } from "@/lib/action-auth";
import { syncNetworkDocs } from "@/lib/network-doc";
import { logAudit } from "@/lib/audit";

/**
 * Manual "sync now" for the current active site. Returns the summary for the
 * UI to render; throws on guard/fetch/sync failure so the client shows the
 * message.
 */
export async function syncNetworkDocsAction() {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) throw new Error(auth.message);

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
}
