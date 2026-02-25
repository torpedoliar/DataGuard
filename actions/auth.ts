
"use server";

import { db } from "../db";
import { users, userSites, sites } from "../db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createSession, deleteSession } from "../lib/session";
import { redirect } from "next/navigation";
import { z } from "zod";
import { updateUserLastLogin } from "./users";

const loginSchema = z.object({
    username: z.string().min(1, "Username wajib diisi"),
    password: z.string().min(1, "Password wajib diisi"),
});

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
        return {
            message: "Username atau password salah.",
        };
    }

    // Check if user is active
    if (user.isActive === false) {
        return {
            message: "Akun Anda telah dinonaktifkan. Hubungi administrator.",
        };
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
        return {
            message: "Username atau password salah.",
        };
    }

    // Cast role safely
    const role = user.role as "superadmin" | "admin" | "staff";

    // Create session WITHOUT a pre-selected site.
    // User will pick their site on the interactive map page.
    await createSession(user.id, user.username, role, null, null);

    // Update last login time (non-blocking)
    updateUserLastLogin(user.id).catch(console.error);

    redirect("/select-site");
}

export async function logout() {
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

    return { success: true, siteName: site[0].name };
}
