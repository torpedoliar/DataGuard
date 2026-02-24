import "server-only";
import { db } from "@/db";
import { userSites, sites } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { verifySession } from "./session";

/**
 * Get the active site ID from the current session.
 * Returns null if no site is selected.
 */
export async function getActiveSiteId(): Promise<number | null> {
    const session = await verifySession();
    if (!session) return null;
    return session.activeSiteId;
}

/**
 * Require that the user has access to a specific site.
 * If siteId is null, returns false.
 */
export async function requireSiteAccess(siteId: number | null): Promise<boolean> {
    if (!siteId) return false;

    const session = await verifySession();
    if (!session) return false;

    // Superadmin has access to all sites
    if (session.role === "superadmin") return true;

    // Check if user is assigned to this site
    const assignment = await db.select().from(userSites)
        .where(and(
            eq(userSites.userId, session.userId),
            eq(userSites.siteId, siteId)
        ))
        .limit(1);

    return assignment.length > 0;
}

/**
 * Get all sites that a user has access to.
 */
export async function getUserSites(userId: number) {
    const session = await verifySession();
    if (!session) return [];

    // Superadmin sees all active sites
    if (session.role === "superadmin") {
        return await db.select({
            id: sites.id,
            name: sites.name,
            code: sites.code,
            address: sites.address,
            roleInSite: userSites.roleInSite,
        })
            .from(sites)
            .leftJoin(userSites, and(
                eq(userSites.siteId, sites.id),
                eq(userSites.userId, userId),
            ))
            .where(eq(sites.isActive, true));
    }

    // Regular users only see assigned sites
    return await db.select({
        id: sites.id,
        name: sites.name,
        code: sites.code,
        address: sites.address,
        roleInSite: userSites.roleInSite,
    })
        .from(userSites)
        .innerJoin(sites, eq(userSites.siteId, sites.id))
        .where(and(
            eq(userSites.userId, userId),
            eq(sites.isActive, true)
        ));
}

/**
 * Check if the current session has admin access (superadmin OR admin role in active site).
 */
export async function hasAdminAccess(): Promise<boolean> {
    const session = await verifySession();
    if (!session) return false;

    if (session.role === "superadmin") return true;

    if (!session.activeSiteId) return false;

    // Check roleInSite
    const assignment = await db.select().from(userSites)
        .where(and(
            eq(userSites.userId, session.userId),
            eq(userSites.siteId, session.activeSiteId),
            eq(userSites.roleInSite, "admin")
        ))
        .limit(1);

    return assignment.length > 0;
}
