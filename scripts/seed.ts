import { db } from "../db";
import { categories, devices, sites, userSites, users } from "../db/schema";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function ensureUser(
    username: string,
    email: string,
    role: "superadmin" | "admin" | "staff",
) {
    const existing = await db.query.users.findFirst({
        where: eq(users.username, username),
    });
    if (existing) return existing;

    const hashedPassword = await bcrypt.hash("password", 10);
    const [created] = await db.insert(users).values({
        username,
        email,
        role,
        passwordHash: hashedPassword,
        isActive: true,
    }).returning();

    return created;
}

async function ensureCategory(name: string) {
    const existing = await db.query.categories.findFirst({
        where: eq(categories.name, name),
    });
    if (existing) return existing;

    const [created] = await db.insert(categories).values({ name }).returning();
    return created;
}

async function ensureDefaultSite() {
    const existing = await db.query.sites.findFirst({
        where: eq(sites.code, "DC-JKT-1"),
    });
    if (existing) return existing;

    const [created] = await db.insert(sites).values({
        name: "Data Center Jakarta (Demo)",
        code: "DC-JKT-1",
        address: "Jl. MH Thamrin No 1, Pusat Kota, Jakarta",
        description: "Data center utama untuk testing / demo",
        latitude: "-6.2088",
        longitude: "106.8456",
        isActive: true,
    }).returning();

    return created;
}

async function ensureUserSite(
    userId: number,
    siteId: number,
    roleInSite: "admin" | "staff",
) {
    const existing = await db.query.userSites.findFirst({
        where: and(eq(userSites.userId, userId), eq(userSites.siteId, siteId)),
    });
    if (existing) return;

    await db.insert(userSites).values({ userId, siteId, roleInSite });
}

async function ensureDevice(siteId: number, categoryId: number, name: string, location: string) {
    const existing = await db.query.devices.findFirst({
        where: and(
            eq(devices.siteId, siteId),
            eq(devices.name, name),
        ),
    });
    if (existing) return;

    await db.insert(devices).values({
        siteId,
        categoryId,
        name,
        location,
    });
}

async function main() {
    console.log("Seeding data...");

    const [adminUser, staffUser, defaultSite] = await Promise.all([
        ensureUser("admin", "admin@example.com", "superadmin"),
        ensureUser("staff", "staff@example.com", "staff"),
        ensureDefaultSite(),
    ]);

    await Promise.all([
        ensureUserSite(adminUser.id, defaultSite.id, "admin"),
        ensureUserSite(staffUser.id, defaultSite.id, "staff"),
    ]);

    const [serverCat, upsCat, cracCat, networkCat] = await Promise.all([
        ensureCategory("Server"),
        ensureCategory("UPS"),
        ensureCategory("CRAC/AC"),
        ensureCategory("Network"),
    ]);

    await Promise.all([
        ensureDevice(defaultSite.id, serverCat.id, "Server APP-01", "Rack A-01"),
        ensureDevice(defaultSite.id, serverCat.id, "Server DB-01", "Rack A-02"),
        ensureDevice(defaultSite.id, serverCat.id, "Server WEB-01", "Rack A-03"),
        ensureDevice(defaultSite.id, upsCat.id, "UPS Unit 1", "Power Room"),
        ensureDevice(defaultSite.id, upsCat.id, "UPS Unit 2", "Power Room"),
        ensureDevice(defaultSite.id, cracCat.id, "CRAC Unit 1", "Cooling Zone A"),
        ensureDevice(defaultSite.id, cracCat.id, "CRAC Unit 2", "Cooling Zone B"),
        ensureDevice(defaultSite.id, networkCat.id, "Core Switch L3", "Network Room"),
        ensureDevice(defaultSite.id, networkCat.id, "Edge Router 1", "Network Room"),
        ensureDevice(defaultSite.id, networkCat.id, "Firewall Main", "Network Room"),
    ]);

    console.log("Seeding complete.");
    console.log("\nDefault credentials:");
    console.log("  Superadmin: username=admin, password=password");
    console.log("  Staff:      username=staff, password=password");
    console.log("\nChange the default passwords after first login.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
