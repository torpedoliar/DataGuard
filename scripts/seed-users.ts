import { db } from "../db";
import { users, sites, userSites } from "../db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
    console.log("Seeding data...");

    // 1. Create Admin User
    const hashedPassword = await bcrypt.hash("password", 10);
    await db.insert(users).values({
        username: "admin",
        email: "admin@example.com",
        role: "superadmin", // Ganti ke superadmin agar auth / admin pages tembus semua tanpa blok
        passwordHash: hashedPassword,
        isActive: true,
    }).onConflictDoNothing();

    // Retrieve the admin user id
    const adminUser = await db.query.users.findFirst({
        where: eq(users.username, "admin")
    });
    console.log("✓ Admin user created/retrieved (username: admin, password: password)");

    // 2. Create Staff User
    const staffPassword = await bcrypt.hash("password", 10);
    await db.insert(users).values({
        username: "staff",
        email: "staff@example.com",
        role: "staff",
        passwordHash: staffPassword,
        isActive: true,
    }).onConflictDoNothing();

    const staffUser = await db.query.users.findFirst({
        where: eq(users.username, "staff")
    });
    console.log("✓ Staff user created/retrieved (username: staff, password: password)");

    // 3. Create Default Site (Jakarta) with Coordinates for Map Selector
    await db.insert(sites).values({
        name: "Data Center Jakarta (Demo)",
        code: "DC-JKT-1",
        address: "Jl. MH Thamrin No 1, Pusat Kota, Jakarta",
        description: "Data Center utama untuk Testing / Demo",
        latitude: "-6.2088", // Koordinat yang cocok di Peta Indonesia SVG
        longitude: "106.8456",
        isActive: true,
    }).onConflictDoNothing();

    // Pastikan ON CONFLICT (code) untuk site... ah pg-core unique().notNull() conflict is usually handled by try-catch
    // Untuk lebih aman ambil site berdasarkan code
    const defaultSite = await db.query.sites.findFirst({
        where: eq(sites.code, "DC-JKT-1")
    });
    console.log("✓ Demo Site created/retrieved (DC-JKT-1)");

    // 4. Hubungkan User dengan Site tersebut agar mereka tidak kosongan
    if (defaultSite) {
        // assign Admin
        if (adminUser) {
            try {
                await db.insert(userSites).values({
                    userId: adminUser.id,
                    siteId: defaultSite.id,
                    roleInSite: "admin"
                });
            } catch (ignored) { } // abaikan conflict
        }
        // assign Staff
        if (staffUser) {
            try {
                await db.insert(userSites).values({
                    userId: staffUser.id,
                    siteId: defaultSite.id,
                    roleInSite: "staff"
                });
            } catch (ignored) { } // abaikan conflict
        }
        console.log("✓ Users assigned to Demo Site");
    }

    console.log("\n✅ Seeding complete!");
    console.log("\nDefault credentials:");
    console.log("  Superadmin : username=admin, password=password");
    console.log("  Staff      : username=staff, password=password");
    console.log("\n⚠️  Remember to change the default passwords!");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
