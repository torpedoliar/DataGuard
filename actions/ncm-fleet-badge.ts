"use server";

import { verifySession } from "@/lib/session";
import { db } from "@/db";
import { incidents, ncmSettings } from "@/db/schema";
import { and, eq, like, or } from "drizzle-orm";

// ==================== Nav badge feed (ticket 10) ====================
// Cheap aggregate for the shell badge: offline sites straight from the
// heartbeat rows (no live-fetch — the 60s poll must not hammer every NCM),
// open drifts counted from DG's own drift incidents. Admin/superadmin only.

export type NcmFleetBadge = { offlineSites: number; openDrifts: number };

export async function getNcmFleetBadge(): Promise<NcmFleetBadge> {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) {
    return { offlineSites: 0, openDrifts: 0 };
  }

  try {
    const offlineRows = await db
      .select({ siteId: ncmSettings.siteId })
      .from(ncmSettings)
      .where(eq(ncmSettings.status, "offline"));

    const driftRows = await db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(
        like(incidents.title, "Config drift:%"),
        or(eq(incidents.status, "Open"), eq(incidents.status, "In Progress")),
      ));

    return { offlineSites: offlineRows.length, openDrifts: driftRows.length };
  } catch {
    return { offlineSites: 0, openDrifts: 0 };
  }
}
