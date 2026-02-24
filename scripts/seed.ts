
import { db } from "../db";
import { users, categories, devices } from "../db/schema";
import bcrypt from "bcryptjs";

async function main() {
    console.log("Seeding data...");

    // 1. Create Admin User
    const hashedPassword = await bcrypt.hash("password", 10);
    await db.insert(users).values({
        username: "admin",
        email: "admin@example.com",
        role: "admin",
        passwordHash: hashedPassword,
        isActive: true,
    }).onConflictDoNothing();

    console.log("Admin user created.");

    // 1b. Create Staff User (for testing)
    const staffPassword = await bcrypt.hash("password", 10);
    await db.insert(users).values({
        username: "staff",
        email: "staff@example.com",
        role: "staff",
        passwordHash: staffPassword,
        isActive: true,
    }).onConflictDoNothing();

    console.log("Staff user created.");

    // 2. Create Categories
    const categoryNames = ["Server", "UPS", "CRAC/AC", "Network"];

    for (const name of categoryNames) {
        await db.insert(categories).values({ name }).onConflictDoNothing();
    }

    console.log("Categories created.");

    // 3. Create Dummy Devices (Optional, for testing)
    // Fetch category IDs first to ensure correct linking
    const allCategories = await db.select().from(categories);

    const serverCat = allCategories.find(c => c.name === "Server");
    const upsCat = allCategories.find(c => c.name === "UPS");
    const cracCat = allCategories.find(c => c.name === "CRAC/AC");
    const networkCat = allCategories.find(c => c.name === "Network");

    if (serverCat) {
        await db.insert(devices).values([
            { categoryId: serverCat.id, name: "Server APP-01", location: "Rack A-01" },
            { categoryId: serverCat.id, name: "Server DB-01", location: "Rack A-02" },
            { categoryId: serverCat.id, name: "Server WEB-01", location: "Rack A-03" },
        ]).onConflictDoNothing();
    }

    if (upsCat) {
        await db.insert(devices).values([
            { categoryId: upsCat.id, name: "UPS Unit 1", location: "Power Room" },
            { categoryId: upsCat.id, name: "UPS Unit 2", location: "Power Room" },
        ]).onConflictDoNothing();
    }

    if (cracCat) {
        await db.insert(devices).values([
            { categoryId: cracCat.id, name: "CRAC Unit 1", location: "Cooling Zone A" },
            { categoryId: cracCat.id, name: "CRAC Unit 2", location: "Cooling Zone B" },
        ]).onConflictDoNothing();
    }

    if (networkCat) {
        await db.insert(devices).values([
            { categoryId: networkCat.id, name: "Core Switch L3", location: "Network Room" },
            { categoryId: networkCat.id, name: "Edge Router 1", location: "Network Room" },
            { categoryId: networkCat.id, name: "Firewall Main", location: "Network Room" },
        ]).onConflictDoNothing();
    }

    console.log("Devices created.");
    console.log("Seeding complete.");
    console.log("\nDefault credentials:");
    console.log("  Admin: username=admin, password=password");
    console.log("  Staff: username=staff, password=password");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
