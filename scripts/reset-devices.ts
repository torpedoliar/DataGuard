import { db } from "../db";
import { devices, categories, checklistItems, checklistEntries } from "../db/schema";

async function main() {
    console.log("Resetting devices and related data...");

    // 1. Delete all checklist items (they reference devices)
    await db.delete(checklistItems);
    console.log("✓ Checklist items deleted.");

    // 2. Delete all checklist entries (they reference users, but we keep users)
    await db.delete(checklistEntries);
    console.log("✓ Checklist entries deleted.");

    // 3. Delete all devices
    await db.delete(devices);
    console.log("✓ All devices deleted.");

    // 4. Delete all categories (optional, to clean up)
    await db.delete(categories);
    console.log("✓ All categories deleted.");

    console.log("\n✅ Reset complete! All devices and related data have been removed.");
    console.log("Users are preserved. Run 'npm run seed:users' if you need to seed users.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
