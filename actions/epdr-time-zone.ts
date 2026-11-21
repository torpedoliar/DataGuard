"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActiveSiteAction } from "@/lib/action-auth";
import { isValidEpdrTimeZone } from "@/lib/epdr/time-zone";

export async function getEpdrTimeZone(): Promise<{ timeZone: string | null } | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  try {
    const { rows } = await db.execute<{ epdr_time_zone: string | null }>(sql`SELECT epdr_time_zone FROM users
      WHERE id = ${guard.session.userId} AND is_active = true`);
    if (!rows[0]) return { message: "Timezone preference unavailable." };
    return { timeZone: rows[0].epdr_time_zone };
  } catch { return { message: "Timezone preference unavailable." }; }
}

export async function setEpdrTimeZone(timeZone: unknown): Promise<{ timeZone: string | null } | { message: string }> {
  const guard = await requireActiveSiteAction();
  if (!guard.ok) return { message: guard.message };
  if (timeZone !== null && !isValidEpdrTimeZone(timeZone)) return { message: "Invalid timezone." };
  try {
    const { rows } = await db.execute<{ epdr_time_zone: string | null }>(sql`UPDATE users
      SET epdr_time_zone = ${timeZone} WHERE id = ${guard.session.userId} AND is_active = true RETURNING epdr_time_zone`);
    if (!rows[0]) return { message: "Timezone preference unavailable." };
    return { timeZone: rows[0].epdr_time_zone };
  } catch { return { message: "Timezone preference unavailable." }; }
}
