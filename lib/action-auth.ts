import "server-only";

import { verifySession } from "@/lib/session";
import { hasAdminAccess } from "@/lib/site-access";

type Session = NonNullable<Awaited<ReturnType<typeof verifySession>>>;

type GuardFailure = {
  ok: false;
  message: string;
};

// Active-site guards reject when no site is selected, so activeSiteId is always
// a concrete number on success.
export type SiteGuardSuccess = {
  ok: true;
  session: Session;
  activeSiteId: number;
};

// Superadmin-only guards do not require an active site, so activeSiteId may be null.
export type SuperadminGuardSuccess = {
  ok: true;
  session: Session;
  activeSiteId: number | null;
};

export type ActionGuardResult = SiteGuardSuccess | GuardFailure;
export type SuperadminActionGuardResult = SuperadminGuardSuccess | GuardFailure;

export async function requireSuperadminAction(): Promise<SuperadminActionGuardResult> {
  const session = await verifySession();
  if (!session || session.role !== "superadmin") {
    return { ok: false, message: "Unauthorized. Superadmin access required." };
  }

  return { ok: true, session, activeSiteId: session.activeSiteId ?? null };
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
