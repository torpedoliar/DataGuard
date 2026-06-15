
"use server";

import { db } from "../db";
import { users, userSites, sites } from "../db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createSession, deleteSession } from "../lib/session";
import { redirect } from "next/navigation";
import { z } from "zod";
import { updateUserLastLogin } from "./users";
import { logAudit, logAuditManual } from "../lib/audit";

const loginSchema = z.object({
    username: z.string().min(1, "Username wajib diisi"),
    password: z.string().min(1, "Password wajib diisi"),
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function login(prevState: unknown, formData: FormData) {
    const result = loginSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
        return {
            errors: result.error.flatten().fieldErrors,
        };
    }

    const { username, password } = result.data;

    const user = await db.query.users.findFirst({
        where: eq(users.username, username),
    });

    if (!user || !user.passwordHash) {
        await logAuditManual({ action: "LOGIN", detail: `Failed login attempt: user ${username} not found` });
        return {
            message: "Username atau password salah.",
        };
    }

    // Check if account is currently locked out
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
        const minutesLeft = Math.ceil(
            (user.lockoutUntil.getTime() - Date.now()) / 60_000,
        );
        await logAuditManual({
            action: "LOGIN",
            userId: user.id,
            username: user.username,
            detail: `Login blocked: account locked (${minutesLeft} min remaining)`,
        });
        return {
            message: `Akun terkunci. Coba lagi dalam ${minutesLeft} menit.`,
        };
    }

    // Check if user is active
    if (user.isActive === false) {
        await logAuditManual({ action: "LOGIN", userId: user.id, username: user.username, detail: "Login failed: Account disabled" });
        return {
            message: "Akun Anda telah dinonaktifkan. Hubungi administrator.",
        };
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
        // Increment failed attempts atomically
        const newFailedCount = (user.failedLoginAttempts ?? 0) + 1;
        const shouldLock = newFailedCount >= MAX_FAILED_ATTEMPTS;
        const lockoutUntil = shouldLock
            ? new Date(Date.now() + LOCKOUT_DURATION_MS)
            : null;

        await db
            .update(users)
            .set({
                failedLoginAttempts: newFailedCount,
                lockoutUntil,
            })
            .where(eq(users.id, user.id));

        if (shouldLock) {
            await logAuditManual({
                action: "LOGIN",
                userId: user.id,
                username: user.username,
                detail: "Account locked after 5 failed attempts",
            });
            return {
                message: `Akun terkunci. Coba lagi dalam 15 menit.`,
            };
        }

        await logAuditManual({ action: "LOGIN", userId: user.id, username: user.username, detail: "Login failed: Incorrect password" });
        return {
            message: "Username atau password salah.",
        };
    }

    // Successful login: reset counter if needed
    if ((user.failedLoginAttempts ?? 0) > 0 || user.lockoutUntil) {
        await db
            .update(users)
            .set({
                failedLoginAttempts: 0,
                lockoutUntil: null,
            })
            .where(eq(users.id, user.id));
    }

    // Cast role safely
    const role = user.role as "superadmin" | "admin" | "staff";

    // Decide which site the session should land on (N50):
    //  1. superadmin with no preference → null (picks on /select-site)
    //  2. user has defaultSiteId AND still has access via userSites → use it
    //  3. user has exactly 1 accessible site → auto-pick it
    //  4. otherwise → null (picks on /select-site)
    let activeSiteId: number | null = null;
    let activeSiteName: string | null = null;
    let redirectTo = "/select-site";

    if (role !== "superadmin") {
        // Fetch the list of active sites the user has access to. We re-use
        // the same join that the /select-site page uses so the two paths
        // agree on which sites count.
        const accessible = await db
            .select({ id: sites.id, name: sites.name })
            .from(userSites)
            .innerJoin(sites, eq(userSites.siteId, sites.id))
            .where(
                and(
                    eq(userSites.userId, user.id),
                    eq(sites.isActive, true)
                )
            )
            .limit(50);

        const accessibleIds = new Set(accessible.map((s) => s.id));

        if (user.defaultSiteId && accessibleIds.has(user.defaultSiteId)) {
            const chosen = accessible.find((s) => s.id === user.defaultSiteId);
            activeSiteId = user.defaultSiteId;
            activeSiteName = chosen?.name ?? null;
            redirectTo = "/checklist";
        } else if (accessible.length === 1) {
            activeSiteId = accessible[0].id;
            activeSiteName = accessible[0].name;
            redirectTo = "/checklist";
        }
    }

    await createSession(user.id, user.username, role, activeSiteId, activeSiteName);

    // Update last login time (non-blocking)
    updateUserLastLogin(user.id).catch(console.error);

    await logAuditManual({ action: "LOGIN", userId: user.id, username: user.username, userRole: role, detail: "Login successful" });

    redirect(redirectTo);
}

export async function logout() {
    await logAudit({ action: "LOGOUT" });
    await deleteSession();
    redirect("/login");
}

/**
 * Switch the active site in the current session (re-creates the JWT).
 */
export async function switchSite(siteId: number) {
    const { verifySession } = await import("../lib/session");
    const session = await verifySession();
    if (!session) return { message: "Sesi telah berakhir. Silakan login kembali." };

    // Verify user has access to this site
    const { requireSiteAccess } = await import("../lib/site-access");
    const hasAccess = await requireSiteAccess(siteId);
    if (!hasAccess) {
        return { message: "Anda tidak memiliki akses ke site ini." };
    }

    // Get site name
    const site = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (site.length === 0) {
        return { message: "Site tidak ditemukan." };
    }

    // Re-create session with new active site
    await createSession(
        session.userId,
        session.username,
        session.role as "superadmin" | "admin" | "staff",
        siteId,
        site[0].name
    );

    await logAudit({ action: "SITE_SWITCH", entity: "site", entityId: siteId, entityName: site[0].name });

    return { success: true, siteName: site[0].name };
}
