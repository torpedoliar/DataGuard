"use server";

import { db } from "@/db";
import { sites, users, userSites, devices, racks, vlans, checklistEntries } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

/**
 * Migration script: Creates default site and assigns all existing data to it.
 * Run this once after schema migration.
 */
export async function migrateToMultiSite() {
    // 1. Check if any site already exists
    const existingSites = await db.select().from(sites).limit(1);
    if (existingSites.length > 0) {
        return { message: "Migrasi sudah pernah dijalankan. Site sudah ada.", skipped: true };
    }

    // 2. Create default site
    const [defaultSite] = await db.insert(sites).values({
        name: "Data Center Utama",
        code: "DC-MAIN",
        address: "Lokasi utama",
        description: "Site default untuk data yang sudah ada sebelumnya",
        isActive: true,
    }).returning();

    const siteId = defaultSite.id;

    // 3. Assign all existing data to default site
    await db.update(devices).set({ siteId }).where(sql`site_id IS NULL`);
    await db.update(racks).set({ siteId }).where(sql`site_id IS NULL`);
    await db.update(vlans).set({ siteId }).where(sql`site_id IS NULL`);
    await db.update(checklistEntries).set({ siteId }).where(sql`site_id IS NULL`);

    // 4. Upgrade first admin user to superadmin
    const adminUser = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
    if (adminUser.length > 0) {
        await db.update(users).set({ role: "superadmin" }).where(eq(users.id, adminUser[0].id));

        // Also assign superadmin to default site
        await db.insert(userSites).values({
            userId: adminUser[0].id,
            siteId,
            roleInSite: "admin",
        });
    }

    // 5. Assign ALL remaining users to default site
    const allUsers = await db.select({ id: users.id }).from(users);
    for (const u of allUsers) {
        // Check if already assigned
        const existing = await db.select().from(userSites)
            .where(sql`user_id = ${u.id} AND site_id = ${siteId}`)
            .limit(1);
        if (existing.length === 0) {
            await db.insert(userSites).values({
                userId: u.id,
                siteId,
                roleInSite: "staff",
            });
        }
    }

    return { success: true, message: `Migrasi selesai! Site "${defaultSite.name}" dibuat dan semua data di-assign.`, siteId };
}
