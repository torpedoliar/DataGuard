import { db } from "../db";
import { users } from "../db/schema";
import bcrypt from "bcryptjs";

async function main() {
    console.log("Seeding users...");

    // 1. Create Admin User
    const hashedPassword = await bcrypt.hash("password", 10);
    await db.insert(users).values({
        username: "admin",
        email: "admin@example.com",
        role: "admin",
        passwordHash: hashedPassword,
        isActive: true,
    }).onConflictDoNothing();

    console.log("✓ Admin user created (username: admin, password: password)");

    // 2. Create Staff User
    const staffPassword = await bcrypt.hash("password", 10);
    await db.insert(users).values({
        username: "staff",
        email: "staff@example.com",
        role: "staff",
        passwordHash: staffPassword,
        isActive: true,
    }).onConflictDoNothing();

    console.log("✓ Staff user created (username: staff, password: password)");

    console.log("\n✅ Seeding complete!");
    console.log("\nDefault credentials:");
    console.log("  Admin: username=admin, password=password");
    console.log("  Staff: username=staff, password=password");
    console.log("\n⚠️  Remember to change the default passwords!");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
