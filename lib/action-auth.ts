import "server-only";

import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";

type Session = NonNullable<Awaited<ReturnType<typeof verifySession>>>;

type GuardSuccess = {
  ok: true;
  session: Session;
  activeSiteId: number;
};

type GuardFailure = {
  ok: false;
  message: string;
};

export type ActionGuardResult = GuardSuccess | GuardFailure;

export async function requireSuperadminAction(): Promise<ActionGuardResult> {
  const session = await verifySession();
  if (!session || session.role !== "superadmin") {
    return { ok: false, message: "Unauthorized. Superadmin access required." };
  }

  return { ok: true, session, activeSiteId: session.activeSiteId ?? 0 };
}

export async function requireActiveSiteAction(): Promise<ActionGuardResult> {
  const session = await verifySession();
  if (!session) return { ok: false, message: "Unauthorized." };
  if (!session.activeSiteId) return { ok: false, message: "No active site selected." };

  return { ok: true, session, activeSiteId: session.activeSiteId };
}

export async function requireActiveSiteAdminAction(): Promise<ActionGuardResult> {
  const activeSite = await requireActiveSiteAction();
  if (!activeSite.ok) return activeSite;

  const allowed = await hasAdminAccess();
  if (!allowed) {
    return { ok: false, message: "Unauthorized. Active-site admin access required." };
  }

  return activeSite;
}
