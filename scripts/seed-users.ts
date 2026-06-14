import { randomBytes } from "node:crypto";
import { db } from "../db";
import { users, sites, userSites } from "../db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

function resolvePassword(envVar: string): string {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  // 12 random bytes -> 16 base64url characters (URL-safe, no padding)
  return randomBytes(12).toString("base64url");
}

function printBanner(role: string, username: string, password: string) {
  const bar = "=".repeat(60);
  console.log("");
  console.log(bar);
  console.log(`  SAVE THIS PASSWORD — ${role} (${username})`);
  console.log(bar);
  console.log(`  ${password}`);
  console.log(bar);
  console.log("  This password is shown only once. Store it in your secret");
  console.log("  manager (e.g. 1Password, Bitwarden) and rotate after first login.");
  console.log("");
}

async function ensureUser(
  username: string,
  email: string,
  role: "superadmin" | "admin" | "staff",
  password: string,
) {
  const existing = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (existing) {
    return { user: existing, created: false };
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const [created] = await db.insert(users).values({
    username,
    email,
    role,
    passwordHash: hashedPassword,
    isActive: true,
  }).returning();

  return { user: created, created: true };
}

async function main() {
    console.log("Seeding data...");

    // 1. Create Admin User
    const adminPassword = resolvePassword("SEED_ADMIN_PASSWORD");
    const { user: adminUser, created: adminCreated } = await ensureUser(
        "admin",
        "admin@example.com",
        "superadmin",
        adminPassword,
    );
    if (adminCreated) {
        printBanner("Superadmin", "admin", adminPassword);
    } else {
        console.log("✓ Admin user already exists (username: admin) — password left unchanged.");
    }

    // 2. Create Staff User
    const staffPassword = resolvePassword("SEED_STAFF_PASSWORD");
    const { user: staffUser, created: staffCreated } = await ensureUser(
        "staff",
        "staff@example.com",
        "staff",
        staffPassword,
    );
    if (staffCreated) {
        printBanner("Staff", "staff", staffPassword);
    } else {
        console.log("✓ Staff user already exists (username: staff) — password left unchanged.");
    }

    // 3. Create Default Site (Jakarta) with Coordinates for Map Selector
    await db.insert(sites).values({
        name: "Data Center Jakarta (Demo)",
        code: "DC-JKT-1",
        address: "Jl. MH Thamrin No 1, Pusat Kota, Jakarta",
        description: "Data Center utama untuk Testing / Demo",
        latitude: "-6.2088", // Koordinan yang cocok di Peta Indonesia SVG
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
            } catch {
                console.warn(`Skipped site link for ${adminUser.username}: already linked or unique-constraint`);
            }
        }
        // assign Staff
        if (staffUser) {
            try {
                await db.insert(userSites).values({
                    userId: staffUser.id,
                    siteId: defaultSite.id,
                    roleInSite: "staff"
                });
            } catch {
                console.warn(`Skipped site link for ${staffUser.username}: already linked or unique-constraint`);
            }
        }
        console.log("✓ Users assigned to Demo Site");
    }

    console.log("\n✅ Seeding complete!");
    console.log("\nNote: passwords are no longer logged to stdout.");
    console.log("  To set a custom admin/staff password, either delete the");
    console.log("  user row and re-run this seed, or use the in-app admin");
    console.log("  reset-password flow at /admin/users.");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
