"use server";

import { verifySession } from "@/lib/session";

export type SuperadminGuard =
  | { ok: true; userId: number; username: string }
  | { ok: false; status: number; message: string };

export async function requireSuperadmin(): Promise<SuperadminGuard> {
  const session = await verifySession();
  if (!session) return { ok: false, status: 401, message: "Sesi tidak valid." };
  if (session.role !== "superadmin") return { ok: false, status: 403, message: "Hanya superadmin yang dapat menggunakan backup dan restore." };
  return { ok: true, userId: session.userId, username: session.username };
}
