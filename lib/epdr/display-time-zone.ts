import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isValidEpdrTimeZone, resolveEpdrTimeZone } from "./time-zone";

/** Call only after active-site access has been checked by the page/action. */
export async function loadEpdrDisplayTimeZone(userId: number, siteId: number) {
  try {
    const { rows } = await db.execute<{ personal: string | null; scheduling: string | null }>(sql`
      SELECT u.epdr_time_zone AS personal, p.time_zone AS scheduling
      FROM users u LEFT JOIN epdr_local_notification_policies p ON p.site_id = ${siteId}
      WHERE u.id = ${userId} AND u.is_active = true`);
    const personalTimeZone = isValidEpdrTimeZone(rows[0]?.personal) ? rows[0].personal : null;
    const siteTimeZone = isValidEpdrTimeZone(rows[0]?.scheduling) ? rows[0].scheduling : "UTC";
    return { personalTimeZone, siteTimeZone, timeZone: resolveEpdrTimeZone(personalTimeZone, siteTimeZone) };
  } catch {
    // A preference read failure must not reveal database diagnostics or guess the browser clock.
    return { personalTimeZone: null, siteTimeZone: "UTC", timeZone: "UTC" };
  }
}
