"use server";

import { db } from "@/db";
import { sites, userSites, users } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { verifySession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

// ==================== SITE CRUD ====================

export async function getSites() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") return [];

    return await db.select().from(sites).orderBy(desc(sites.createdAt));
}

export async function getSiteById(id: number) {
    const session = await verifySession();
    if (!session) return null;

    return await db.select().from(sites).where(eq(sites.id, id)).limit(1).then(r => r[0] || null);
}

export async function addSite(data: { name: string; code: string; address?: string; description?: string; telegramChatId?: string; latitude?: string; longitude?: string }) {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Hanya Super Admin yang dapat menambah site baru." };
    }

    if (!data.name || !data.code) {
        return { message: "Nama dan Kode Site wajib diisi." };
    }

    try {
        await db.insert(sites).values({
            name: data.name,
            code: data.code.toUpperCase(),
            address: data.address || null,
            description: data.description || null,
            telegramChatId: data.telegramChatId || null,
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            isActive: true,
        });

        await logAudit({ action: "CREATE", entity: "site", entityName: data.name, detail: `Code: ${data.code}` });

        revalidatePath("/admin/sites");
        return { success: true, message: "Site berhasil ditambahkan!" };
    } catch (error: any) {
        if (error?.message?.includes("UNIQUE constraint")) {
            return { message: "Kode site sudah digunakan. Silakan pilih kode lain." };
        }
        return { message: "Gagal menyimpan site. Silakan coba lagi." };
    }
}

export async function updateSite(id: number, data: { name: string; code?: string; address?: string; description?: string; telegramChatId?: string; latitude?: string; longitude?: string; isActive?: boolean }) {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Hanya Super Admin yang dapat mengubah site." };
    }

    try {
        await db.update(sites).set({
            name: data.name,
            code: data.code?.toUpperCase(),
            address: data.address || null,
            description: data.description || null,
            telegramChatId: data.telegramChatId || null,
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            isActive: data.isActive,
        }).where(eq(sites.id, id));

        await logAudit({ action: "UPDATE", entity: "site", entityId: id, entityName: data.name, detail: `Code: ${data.code}` });

        revalidatePath("/admin/sites");
        revalidatePath("/", "layout"); // Revalidate Top Navbar
        return { success: true, message: "Site berhasil diperbarui!" };
    } catch (error: any) {
        if (error?.message?.includes("UNIQUE constraint")) {
            return { message: "Kode site sudah digunakan." };
        }
        return { message: "Gagal memperbarui site." };
    }
}

export async function deleteSite(id: number) {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Hanya Super Admin yang dapat menghapus site." };
    }

    try {
        // Remove all user-site assignments first
        await db.delete(userSites).where(eq(userSites.siteId, id));
        await db.delete(sites).where(eq(sites.id, id));

        await logAudit({ action: "DELETE", entity: "site", entityId: id });

        revalidatePath("/admin/sites");
        return { success: true, message: "Site berhasil dihapus." };
    } catch (error) {
        return { message: "Gagal menghapus site. Mungkin masih ada data perangkat di dalamnya." };
    }
}

// ==================== USER-SITE ASSIGNMENT ====================

export async function getSiteUsers(siteId: number) {
    const session = await verifySession();
    if (!session) return [];

    return await db.select({
        assignmentId: userSites.id,
        userId: users.id,
        username: users.username,
        email: users.email,
        globalRole: users.role,
        roleInSite: userSites.roleInSite,
        isActive: users.isActive,
    })
        .from(userSites)
        .innerJoin(users, eq(userSites.userId, users.id))
        .where(eq(userSites.siteId, siteId));
}

export async function getUnassignedUsers(siteId: number) {
    const session = await verifySession();
    if (!session || (session.role !== "superadmin" && session.role !== "admin")) return [];

    // Get all active users not in this site
    const allUsers = await db.select({ id: users.id, username: users.username, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.isActive, true));

    const assigned = await db.select({ userId: userSites.userId })
        .from(userSites)
        .where(eq(userSites.siteId, siteId));

    const assignedIds = new Set(assigned.map(a => a.userId));
    return allUsers.filter(u => !assignedIds.has(u.id));
}

export async function assignUserToSite(userId: number, siteId: number, roleInSite: "admin" | "staff") {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Hanya Super Admin yang dapat menetapkan user ke site." };
    }

    // Check if already assigned
    const existing = await db.select().from(userSites)
        .where(and(eq(userSites.userId, userId), eq(userSites.siteId, siteId)))
        .limit(1);

    if (existing.length > 0) {
        return { message: "User sudah ditugaskan ke site ini." };
    }

    try {
        await db.insert(userSites).values({ userId, siteId, roleInSite });

        await logAudit({ action: "CREATE", entity: "user_site", detail: `UserID: ${userId}, SiteID: ${siteId}, Role: ${roleInSite}` });

        revalidatePath("/admin/sites");
        return { success: true, message: "User berhasil ditugaskan ke site!" };
    } catch (error) {
        return { message: "Gagal menugaskan user." };
    }
}

export async function updateUserSiteRole(assignmentId: number, roleInSite: "admin" | "staff") {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Hanya Super Admin yang dapat mengubah hak akses." };
    }

    try {
        await db.update(userSites).set({ roleInSite }).where(eq(userSites.id, assignmentId));

        await logAudit({ action: "UPDATE", entity: "user_site", entityId: assignmentId, detail: `New Role: ${roleInSite}` });

        revalidatePath("/admin/sites");
        return { success: true };
    } catch (error) {
        return { message: "Gagal mengubah role user." };
    }
}

export async function removeUserFromSite(assignmentId: number) {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        return { message: "Hanya Super Admin yang dapat melepas user dari site." };
    }

    try {
        await db.delete(userSites).where(eq(userSites.id, assignmentId));

        await logAudit({ action: "DELETE", entity: "user_site", entityId: assignmentId });

        revalidatePath("/admin/sites");
        return { success: true, message: "User berhasil dihapus dari site." };
    } catch (error) {
        return { message: "Gagal menghapus assignment user." };
    }
}
