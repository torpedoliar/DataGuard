"use server";

import { db } from "../db";
import { users, userSites, sites } from "../db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { verifySession } from "../lib/session";
import { revalidatePath } from "next/cache";
import { logAudit } from "../lib/audit";

// Schemas
const createUserSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Invalid email address").optional().or(z.literal("")),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum(["superadmin", "admin", "staff"]).default("staff"),
    isActive: z.boolean().default(true),
});

const updateUserSchema = createUserSchema.partial();

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
    confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

export type UserFormData = z.infer<typeof createUserSchema>;

// Get all users
export async function getUsers() {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return [];
    }

    const allUsers = await db.query.users.findMany({
        with: {
            userSites: {
                with: {
                    site: true,
                },
            },
        },
        orderBy: [desc(users.createdAt)],
    });

    // Map to include a flat list of sites for easier UI rendering
    return allUsers.map(user => ({
        ...user,
        sites: user.userSites.map(us => us.site),
    }));
}

// Get single user by ID
export async function getUserById(id: number) {
    const session = await verifySession();
    if (!session) return null;

    const user = await db.query.users.findFirst({
        where: eq(users.id, id),
    });

    // Don't return password hash
    if (user) {
        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    return null;
}

// Create new user
export async function createUser(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized" };
    }

    const parsed = createUserSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    const { username, email, password, role, isActive } = parsed.data;

    // Get site IDs from form data
    const siteIdsList = formData.getAll("siteIds") as string[];
    const siteIds = siteIdsList.map(Number).filter(id => !isNaN(id));

    // Check if username already exists
    const existingUser = await db.query.users.findFirst({
        where: eq(users.username, username),
    });

    if (existingUser) {
        return { message: "Username already exists" };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    try {
        const [newUser] = await db.insert(users).values({
            username,
            email: email || null,
            passwordHash,
            role,
            isActive,
        }).returning({ id: users.id });

        // If not superadmin and sites are selected, assign them
        if (role !== "superadmin" && siteIds.length > 0) {
            const userSiteValues = siteIds.map(siteId => ({
                userId: newUser.id,
                siteId: siteId,
                roleInSite: role as "admin" | "staff"
            }));
            await db.insert(userSites).values(userSiteValues);
        }

        revalidatePath("/admin/users");
        await logAudit({ action: "CREATE", entity: "user", entityName: username, detail: `Role: ${role}, Sites: ${siteIds.length}` });
        return { success: true, message: "User created successfully" };
    } catch (error) {
        console.error("Create user error:", error);
        return { message: "Failed to create user" };
    }
}

// Update user
export async function updateUser(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized" };
    }

    const id = Number(formData.get("id"));
    if (!id) {
        return { message: "Invalid user ID" };
    }

    // Get site IDs from form data
    const siteIdsList = formData.getAll("siteIds") as string[];
    const siteIds = siteIdsList.map(Number).filter(n => !isNaN(n));

    // Get only the fields that are present in the form
    const updateData: Record<string, unknown> = {};

    const username = formData.get("username") as string;
    const email = formData.get("email") as string;
    const role = formData.get("role") as "superadmin" | "admin" | "staff";
    const isActive = formData.get("isActive") === "on";

    if (username) updateData.username = username;
    if (email !== undefined) updateData.email = email || null;
    if (role) updateData.role = role;
    updateData.isActive = isActive;

    // Check if username is being changed and if it already exists
    if (username) {
        const existingUser = await db.query.users.findFirst({
            where: eq(users.username, username),
        });

        if (existingUser && existingUser.id !== id) {
            return { message: "Username already exists" };
        }
    }

    try {
        // Update user record
        await db.update(users).set(updateData).where(eq(users.id, id));

        // Update site bindings
        await db.delete(userSites).where(eq(userSites.userId, id));
        if (role !== "superadmin" && siteIds.length > 0) {
            const userSiteValues = siteIds.map(siteId => ({
                userId: id,
                siteId: siteId,
                roleInSite: role as "admin" | "staff"
            }));
            await db.insert(userSites).values(userSiteValues);
        }

        revalidatePath("/admin/users");
        await logAudit({ action: "UPDATE", entity: "user", entityId: id, entityName: username });
        return { success: true, message: "User updated successfully" };
    } catch (error) {
        console.error("Update user error:", error);
        return { message: "Failed to update user" };
    }
}

// Delete user
export async function deleteUser(id: number) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized" };
    }

    // Prevent deleting yourself
    if (id === session.userId) {
        return { message: "Cannot delete your own account" };
    }

    try {
        // Hapus akses site user terlebih dahulu (cascade manual)
        await db.delete(userSites).where(eq(userSites.userId, id));
        // Hapus user
        await db.delete(users).where(eq(users.id, id));

        revalidatePath("/admin/users");
        await logAudit({ action: "DELETE", entity: "user", entityId: id });
        return { success: true };
    } catch (error) {
        console.error("Delete user error:", error);
        return { message: "Failed to delete user" };
    }
}

// Change own password
export async function changePassword(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session) {
        return { message: "Unauthorized" };
    }

    const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    const { currentPassword, newPassword } = parsed.data;

    // Get current user
    const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
    });

    if (!user || !user.passwordHash) {
        return { message: "User not found" };
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatch) {
        return { message: "Current password is incorrect" };
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10);

    try {
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, session.userId));
        await logAudit({ action: "UPDATE", entity: "user", entityId: session.userId, detail: "Password changed" });
        return { success: true, message: "Password changed successfully" };
    } catch (error) {
        console.error("Change password error:", error);
        return { message: "Failed to change password" };
    }
}

// Admin reset user password
export async function adminResetPassword(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session || !["admin", "superadmin"].includes(session.role)) {
        return { message: "Unauthorized" };
    }

    const id = Number(formData.get("id"));
    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (!id) return { message: "Invalid user ID" };
    if (!newPassword || newPassword.length < 6) return { message: "New password must be at least 6 characters" };
    if (newPassword !== confirmPassword) return { message: "Passwords do not match" };

    try {
        const targetUser = await db.query.users.findFirst({ where: eq(users.id, id) });
        if (!targetUser) return { message: "User not found" };

        const newHash = await bcrypt.hash(newPassword, 10);
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, id));

        await logAudit({ action: "UPDATE", entity: "user", entityId: id, entityName: targetUser.username, detail: "Password reset by admin" });
        return { success: true, message: "User password reset successfully" };
    } catch (error) {
        console.error("Admin reset password error:", error);
        return { message: "Failed to reset user password" };
    }
}

// Update user last login
export async function updateUserLastLogin(userId: number) {
    try {
        await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, userId));
    } catch (error) {
        console.error("Update last login error:", error);
    }
}

// Update user photo
export async function updateProfilePhoto(prevState: unknown, formData: FormData) {
    const session = await verifySession();
    if (!session) {
        return { message: "Unauthorized" };
    }

    const { existsSync } = await import("fs");
    const { mkdir, writeFile, unlink } = await import("fs/promises");
    const path = await import("path");

    const photo = formData.get("photo") as File | null;
    const removePhoto = formData.get("removePhoto") === "true";

    // Get current user to check for existing photo
    const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
    });

    if (!user) {
        return { message: "User not found" };
    }

    let photoPath = user.photoPath;

    try {
        if (removePhoto && photoPath) {
            // Delete existing photo if explicitly requested or replaced
            const fullPath = path.join(process.cwd(), "public", photoPath);
            if (existsSync(fullPath)) await unlink(fullPath);
            photoPath = null;
        }

        if (photo && photo.size > 0 && !removePhoto) {
            // Setup upload directory
            const uploadDir = path.join(process.cwd(), "public", "uploads", "profiles");
            if (!existsSync(uploadDir)) {
                await mkdir(uploadDir, { recursive: true });
            }

            // Create unique filename
            const ext = photo.name.split(".").pop();
            const fileName = `user-${session.userId}-${Date.now()}.${ext}`;
            const fullPath = path.join(uploadDir, fileName);

            // Convert arrayBuffer to buffer
            const arrayBuffer = await photo.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Write new file
            await writeFile(fullPath, buffer);

            // Delete old photo if replacing
            if (user.photoPath) {
                const oldPath = path.join(process.cwd(), "public", user.photoPath);
                if (existsSync(oldPath)) await unlink(oldPath);
            }

            photoPath = `/uploads/profiles/${fileName}`;
        }

        // Update database
        await db.update(users)
            .set({ photoPath })
            .where(eq(users.id, session.userId));

        revalidatePath("/");
        revalidatePath("/profile");

        return { success: true, message: "Profil berhasil diperbarui." };
    } catch (error) {
        console.error("Update profile photo error:", error);
        return { message: "Gagal memperbarui foto profil." };
    }
}
